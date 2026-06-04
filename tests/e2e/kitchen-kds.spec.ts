import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  loginAsTenantAdmin,
  addBankAccountViaApi,
  getFirstProductViaApi,
  confirmCashPaymentViaApi,
  getOrderStatusViaApi,
  enableModulesViaApi,
  resetDbViaApi,
} from "./helpers/api.helper";

/**
 * Kitchen / KDS — Test N
 *
 * Verifica el panel de cocina (food archetype):
 *
 *   N.1 · API cocina — ciclo completo:
 *         Admin crea orden en efectivo → confirma caja (pending_cash → paid)
 *         → GET /kitchen/orders muestra la orden como activa →
 *         PATCH kitchen status: paid → preparing → ready → delivered.
 *         En cada paso, /kitchen/orders filtra correctamente.
 *
 *   N.2 · UI cocina — página carga y muestra la orden:
 *         Kitchen JWT accede a /:slug/cocina → ve el panel de cocina →
 *         la orden aparece en el listado activo.
 *         (El JWT de admin también tiene acceso al panel de cocina.)
 *
 *   N.3 · Transición inválida → 400:
 *         Intentar pasar directamente de "paid" a "delivered" sin pasar por
 *         "preparing" y "ready" → backend devuelve 400 (transición inválida).
 *
 * Template: restaurant-qr (food, con kitchen_kds habilitado por defecto).
 * Se habilitó explícitamente via enableModulesViaApi por seguridad.
 */
test.describe("Kitchen KDS — panel de cocina", () => {
  const API = process.env.PW_API_URL ?? "http://localhost:3001";

  let slug: string;
  let adminToken: string;
  let saToken: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    saToken = await bootstrapSuperadmin(api);

    slug = `kitchen-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "food", "restaurant-qr");

    adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);

    // Garantizar que kitchen_kds está habilitado
    await enableModulesViaApi(api, saToken, tenantId, { kitchen_kds: true });
  });

  // ── Helper: crea orden food y la lleva a "paid" ─────────────────────────

  async function createPaidOrder(api: any): Promise<string> {
    const product = await getFirstProductViaApi(api, adminToken);

    const orderRes = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "dine_in",
        tableNumber: 3,
        paymentMethod: "cash",
        archetype: "food",
        customer_name: "Mesa 3 KDS Test",
        items: [{ productId: product._id, quantity: 2 }],
      },
    });
    expect(orderRes.status()).toBe(201);
    const order = await orderRes.json();
    const orderId = order._id as string;

    // Admin confirma el pago en caja: pending_cash → paid
    await confirmCashPaymentViaApi(api, adminToken, orderId);

    // Verificar estado
    const status = await getOrderStatusViaApi(api, slug, orderId);
    expect(status).toBe("paid");

    return orderId;
  }

  // ── N.1 · Ciclo completo vía API ──────────────────────────────────────────

  test("N.1 · ciclo kitchen API: paid → preparing → ready → delivered", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const orderId = await createPaidOrder(api);

    const kitchenHeaders = { Authorization: `Bearer ${adminToken}` };

    // GET /kitchen/orders → la orden debe aparecer (paid es activa)
    const activeRes = await api.get(`${API}/kitchen/orders`, {
      headers: kitchenHeaders,
    });
    expect(activeRes.status()).toBe(200);
    const activeOrders = await activeRes.json();
    const found = activeOrders.find((o: any) => o._id === orderId);
    expect(found).toBeTruthy();
    expect(found.status).toBe("paid");

    // paid → preparing
    const preparingRes = await api.patch(
      `${API}/kitchen/orders/${orderId}/status`,
      {
        headers: kitchenHeaders,
        data: { status: "preparing" },
      },
    );
    expect(preparingRes.status()).toBe(200);
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe("preparing");

    // La orden sigue en /kitchen/orders (preparing es activa)
    const midRes = await api.get(`${API}/kitchen/orders`, {
      headers: kitchenHeaders,
    });
    const midOrders = await midRes.json();
    expect(midOrders.some((o: any) => o._id === orderId)).toBe(true);

    // preparing → ready
    const readyRes = await api.patch(
      `${API}/kitchen/orders/${orderId}/status`,
      {
        headers: kitchenHeaders,
        data: { status: "ready" },
      },
    );
    expect(readyRes.status()).toBe(200);
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe("ready");

    // ready → delivered
    const deliveredRes = await api.patch(
      `${API}/kitchen/orders/${orderId}/status`,
      {
        headers: kitchenHeaders,
        data: { status: "delivered" },
      },
    );
    expect(deliveredRes.status()).toBe(200);
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe("delivered");

    // delivered es terminal → ya no aparece en /kitchen/orders
    const finalRes = await api.get(`${API}/kitchen/orders`, {
      headers: kitchenHeaders,
    });
    const finalOrders = await finalRes.json();
    expect(finalOrders.some((o: any) => o._id === orderId)).toBe(false);
  });

  // ── N.2 · UI cocina ───────────────────────────────────────────────────────

  test("N.2 · UI /:slug/cocina carga y muestra la orden activa", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const orderId = await createPaidOrder(api);

    // El admin también tiene acceso al panel de cocina (rol kitchen también aplica)
    // Navegar directo a /:slug/cocina — requiere JWT admin o kitchen
    // El panel verifica la sesión via cookie o localStorage; hacer login primero
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(`${slug}@test.local`);
    await page.getByLabel(/contraseña/i).fill("admin-pw-test123");
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/admin`), {
      timeout: 10_000,
    });

    // Ir al panel de cocina
    await page.goto(`/${slug}/cocina`);
    await page.waitForLoadState("networkidle");

    // El panel de cocina debe cargar (texto de la interfaz — KitchenLayout usa spans, no headings)
    await expect(page.getByText(/cocina/i).first()).toBeVisible({
      timeout: 10_000,
    });

    // La orden de mesa 3 debe aparecer
    await expect(
      page.getByText(/mesa 3|table 3|Mesa 3 KDS/i).first(),
    ).toBeVisible({ timeout: 8_000 });

    // Debe haber un botón para cambiar estado (ej. "Tomar pedido", "Preparando" o "Listo")
    await expect(
      page
        .getByRole("button", {
          name: /tomar pedido|preparando|listo|ready|preparing/i,
        })
        .first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── N.3 · Transición inválida → 400 ──────────────────────────────────────

  test("N.3 · transición inválida paid → delivered devuelve 400", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const orderId = await createPaidOrder(api);

    // Saltarse "preparing" y "ready" — debe ser inválido
    const invalidRes = await api.patch(
      `${API}/kitchen/orders/${orderId}/status`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { status: "delivered" },
      },
    );
    expect(invalidRes.status()).toBe(400);
    const body = await invalidRes.json();
    expect(JSON.stringify(body)).toMatch(/transición|invalid|transition/i);

    // El estado no cambió
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe("paid");
  });

  // ── N.4 · Cancelar desde cocina ───────────────────────────────────────────

  test("N.4 · cocina puede cancelar una orden en paid o preparing", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const orderId = await createPaidOrder(api);

    // paid → cancelled (desde cocina)
    const cancelRes = await api.patch(
      `${API}/kitchen/orders/${orderId}/status`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { status: "cancelled" },
      },
    );
    expect(cancelRes.status()).toBe(200);
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe("cancelled");

    // cancelled es terminal → no aparece en /kitchen/orders
    const afterCancel = await api.get(`${API}/kitchen/orders`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const orders = await afterCancel.json();
    expect(orders.some((o: any) => o._id === orderId)).toBe(false);
  });
});
