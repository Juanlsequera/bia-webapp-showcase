import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  loginAsTenantAdmin,
  addBankAccountViaApi,
  createStaffViaApi,
  resetDbViaApi,
} from "./helpers/api.helper";

/**
 * Security & Integrity — Batch A→E
 *
 * Pruebas de seguridad e integridad de la plataforma. No requieren browser —
 * todo se ejerce vía HTTP con playwright.request. Son las más críticas para
 * poder salir a producción con los 4 arquetipos.
 *
 *   A · Cross-tenant isolation
 *       Admin del tenant A intenta verificar un PagoMóvil del tenant B.
 *       El backend debe responder 403 (ForbiddenException por tenantId mismatch).
 *
 *   B · Discrepancia PagoMóvil >2%
 *       Admin intenta aprobar un pago cuyo monto declarado difiere >2% del
 *       monto esperado. Sin force_approve → 400. Con force_approve → 200.
 *
 *   C · Anti double-booking
 *       Dos reservas simultáneas para el mismo staff + mismo horario.
 *       La segunda debe retornar 409 / 400 (ConflictException).
 *
 *   D · SEC-01 — cancellation token
 *       Cancelar reserva sin token  → 403.
 *       Cancelar con token erróneo  → 403.
 *       Cancelar con JWT admin      → 200 (bypass de token).
 *
 *   E · Concurrencia con stock=1
 *       Dos pedidos simultáneos para un producto con stock=1.
 *       Exactamente uno debe crearse (201); el otro debe fallar (400/409).
 *
 * Bug fix incluido en este commit:
 *   order.service.ts → expireStaleOrders ahora incluye "pending_cash" además
 *   de "pending_verification" en el filtro del barrido periódico.
 */
test.describe("Security & Integrity", () => {
  const API = process.env.PW_API_URL ?? "http://localhost:3001";

  let saToken: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    saToken = await bootstrapSuperadmin(api);
  });

  // ── Helpers internos ───────────────────────────────────────────────────────

  /** Crea un tenant food con PagoMóvil y devuelve { slug, adminToken } */
  async function setupFoodTenant(api: any, suffix: string) {
    const slug = `sec-food-${suffix}-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "food", "restaurant-qr");
    const adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);
    return { slug, adminToken };
  }

  /** Crea una orden food con PagoMóvil y devuelve el orderId */
  async function createFoodOrderPagoMovil(
    api: any,
    slug: string,
    productId: string,
  ): Promise<string> {
    const res = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "dine_in",
        tableNumber: 1,
        paymentMethod: "pagomovil",
        archetype: "food",
        items: [{ productId, quantity: 1 }],
      },
    });
    const body = await res.json();
    if (!res.ok()) {
      throw new Error(
        `createFoodOrderPagoMovil failed (${res.status()}): ${JSON.stringify(body)}`,
      );
    }
    return body._id as string;
  }

  /** Obtiene el primer producto del tenant */
  async function getFirstProduct(
    api: any,
    adminToken: string,
  ): Promise<{ _id: string; price: number }> {
    const res = await api.get(`${API}/admin/products`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const body = await res.json();
    const items = Array.isArray(body) ? body : (body.items ?? []);
    if (!items.length) throw new Error("No hay productos en el tenant");
    return { _id: items[0]._id as string, price: items[0].price as number };
  }

  /** Envía el comprobante PagoMóvil desde el lado del cliente (PATCH /:slug/orders/:id/pagomovil) */
  async function submitPagoMovil(
    api: any,
    slug: string,
    orderId: string,
    amountBs: number,
  ): Promise<void> {
    const res = await api.patch(`${API}/${slug}/orders/${orderId}/pagomovil`, {
      data: {
        pagomovil_reference: "123456789012",
        pagomovil_phone: "04141234567",
        pagomovil_bank: "Banesco",
        pagomovil_amount: amountBs,
      },
    });
    if (!res.ok()) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `submitPagoMovil failed (${res.status()}): ${JSON.stringify(body)}`,
      );
    }
  }

  // ── A · Cross-tenant isolation ─────────────────────────────────────────────

  test("A · admin de tenant A no puede verificar una orden del tenant B → 403", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    // Crear dos tenants independientes
    const tenantA = await setupFoodTenant(api, "a");
    const tenantB = await setupFoodTenant(api, "b");

    // Obtener producto del tenant B y crear una orden en B
    const productB = await getFirstProduct(api, tenantB.adminToken);
    const orderIdB = await createFoodOrderPagoMovil(
      api,
      tenantB.slug,
      productB._id,
    );

    // Cliente de B envía el comprobante (monto coherente para no pisar el guard de discrepancia)
    const tenantBRate = 400; // Bs aproximados para $X — no importa el valor exacto aquí
    await submitPagoMovil(
      api,
      tenantB.slug,
      orderIdB,
      productB.price * tenantBRate,
    );

    // Admin de A intenta verificar la orden de B → DEBE recibir 403
    const verifyRes = await api.patch(
      `${API}/admin/orders/${orderIdB}/verify-pagomovil`,
      {
        headers: { Authorization: `Bearer ${tenantA.adminToken}` },
        data: { decision: "approved", force_approve: true },
      },
    );

    // ForbiddenException: orden no pertenece al negocio del admin A
    expect(verifyRes.status()).toBe(403);
  });

  // ── B · Discrepancia PagoMóvil >2% ─────────────────────────────────────────

  test("B · discrepancia >2% bloquea verificación — force_approve la desbloquea", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const { slug, adminToken } = await setupFoodTenant(api, "b");

    const product = await getFirstProduct(api, adminToken);
    const orderId = await createFoodOrderPagoMovil(api, slug, product._id);

    // El cliente declara 1 Bs — claramente muy lejos del monto real (ej. ~400 Bs)
    // La discrepancia será >>2%, así que el guard debe dispararse
    await submitPagoMovil(api, slug, orderId, 1);

    const adminApi = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${adminToken}` },
    });

    // Sin force_approve → 400 (discrepancy guard)
    const blockedRes = await adminApi.patch(
      `${API}/admin/orders/${orderId}/verify-pagomovil`,
      { data: { decision: "approved" } },
    );
    expect(blockedRes.status()).toBe(400);
    const blockedBody = await blockedRes.json();
    // El mensaje debe mencionar la discrepancia
    expect(JSON.stringify(blockedBody)).toMatch(/discrepan|monto|amount/i);

    // Con force_approve: true → 200 (admin decide ignorar discrepancia)
    const forcedRes = await adminApi.patch(
      `${API}/admin/orders/${orderId}/verify-pagomovil`,
      { data: { decision: "approved", force_approve: true } },
    );
    expect(forcedRes.status()).toBe(200);
    const forcedBody = await forcedRes.json();
    // La orden queda pagada
    expect(forcedBody.status ?? forcedBody.order?.status).toMatch(/paid/i);
  });

  // ── C · Anti double-booking ─────────────────────────────────────────────────

  test("C · dos reservas en el mismo slot y staff devuelven conflicto en la segunda", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const slug = `sec-book-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "booking", "barbershop");
    const adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);
    const staffId = await createStaffViaApi(api, adminToken);

    // Obtener un servicio del tenant
    const servicesRes = await api.get(`${API}/admin/products`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const servicesBody = await servicesRes.json();
    const services = Array.isArray(servicesBody)
      ? servicesBody
      : (servicesBody.items ?? []);
    expect(services.length).toBeGreaterThan(0);
    const serviceId = services[0]._id as string;

    const SLOT = "2026-09-15T10:00:00Z"; // slot único de prueba

    // Primera reserva — debe crearse sin problemas
    const first = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "takeaway",
        paymentMethod: "cash",
        customer_name: "Cliente Uno",
        archetype: "booking",
        staffId,
        bookingDatetime: SLOT,
        items: [{ productId: serviceId, quantity: 1 }],
      },
    });
    expect(first.status()).toBe(201);

    // Segunda reserva en EXACTAMENTE el mismo slot y staff → conflicto
    const second = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "takeaway",
        paymentMethod: "cash",
        customer_name: "Cliente Dos",
        archetype: "booking",
        staffId,
        bookingDatetime: SLOT,
        items: [{ productId: serviceId, quantity: 1 }],
      },
    });

    // El backend debe rechazar con 409 (ConflictException) o 400 (BadRequestException)
    expect([400, 409]).toContain(second.status());
    const secondBody = await second.json();
    expect(JSON.stringify(secondBody)).toMatch(/ocupa|conflict|slot|disponib/i);
  });

  // ── D · SEC-01 — cancellation token ─────────────────────────────────────────

  test("D · SEC-01: sin token → 403, token erróneo → 403, admin JWT → 200", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const slug = `sec-sec01-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "booking", "barbershop");
    const adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);
    const staffId = await createStaffViaApi(api, adminToken);

    // Obtener servicio
    const servicesRes = await api.get(`${API}/admin/products`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const servicesBody = await servicesRes.json();
    const services = Array.isArray(servicesBody)
      ? servicesBody
      : (servicesBody.items ?? []);
    const serviceId = services[0]._id as string;

    // Crear la reserva
    const orderRes = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "takeaway",
        paymentMethod: "cash",
        customer_name: "Cliente SEC-01",
        archetype: "booking",
        staffId,
        bookingDatetime: "2026-09-20T11:00:00Z",
        items: [{ productId: serviceId, quantity: 1 }],
      },
    });
    expect(orderRes.status()).toBe(201);
    const order = await orderRes.json();
    const orderId = order._id as string;

    // ── Sin token (cliente público sin JWT y sin cancellation_token) → 403 ────
    const noTokenRes = await api.post(
      `${API}/${slug}/orders/${orderId}/cancel-booking`,
      { data: { reason: "Test sin token" } },
    );
    expect(noTokenRes.status()).toBe(403);

    // ── Token erróneo (64 hex chars inventados) → 403 ────────────────────────
    const fakeToken = "a".repeat(64);
    const wrongTokenRes = await api.post(
      `${API}/${slug}/orders/${orderId}/cancel-booking`,
      { data: { reason: "Test token malo", cancellation_token: fakeToken } },
    );
    expect(wrongTokenRes.status()).toBe(403);

    // ── Admin con JWT válido → 200 (bypass del token) ─────────────────────────
    const adminCancelRes = await api.post(
      `${API}/${slug}/orders/${orderId}/cancel-booking`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { reason: "Cancelado por admin en test E2E" },
      },
    );
    expect(adminCancelRes.status()).toBe(200);
    const cancelledOrder = await adminCancelRes.json();
    expect(cancelledOrder.order?.status ?? cancelledOrder.status).toMatch(
      /cancel/i,
    );
  });

  // ── E · Concurrencia con stock=1 ────────────────────────────────────────────

  test("E · dos pedidos simultáneos con stock=1 → exactamente uno exitoso", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const slug = `sec-stock-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "retail", "clothing-store");
    const adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);

    // Obtener el primer producto y poner stock=1 con tracking activo
    const productRes = await api.get(`${API}/admin/products`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const productBody = await productRes.json();
    const products = Array.isArray(productBody)
      ? productBody
      : (productBody.items ?? []);
    expect(products.length).toBeGreaterThan(0);
    const productId = products[0]._id as string;

    // Actualizar el producto: stock_enabled=true, stock_qty=1
    const updateRes = await api.put(`${API}/admin/products/${productId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        stock_enabled: true,
        stock_qty: 1,
      },
    });
    expect(updateRes.status()).toBeLessThan(300);

    // Lanzar dos pedidos en paralelo por el mismo producto
    const orderPayload = {
      orderType: "dine_in",
      tableNumber: 1,
      paymentMethod: "cash",
      archetype: "retail",
      items: [{ productId, quantity: 1 }],
    };

    const [res1, res2] = await Promise.all([
      api.post(`${API}/${slug}/orders`, { data: orderPayload }),
      api.post(`${API}/${slug}/orders`, { data: orderPayload }),
    ]);

    const statuses = [res1.status(), res2.status()];

    // Exactamente UNO debe haber creado la orden (201)
    const successes = statuses.filter((s) => s === 201);
    const failures = statuses.filter((s) => s >= 400);

    expect(successes).toHaveLength(1);
    expect(failures).toHaveLength(1);

    // El que falló debe indicar falta de stock (400 o 409)
    const failedRes = res1.status() >= 400 ? res1 : res2;
    expect([400, 409]).toContain(failedRes.status());
    const failedBody = await failedRes.json();
    expect(JSON.stringify(failedBody)).toMatch(/stock|inventario|agotado/i);
  });
});
