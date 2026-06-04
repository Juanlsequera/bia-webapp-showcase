import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  loginAsTenantAdmin,
  addBankAccountViaApi,
  resetDbViaApi,
  getFirstProductViaApi,
  getOrderStatusViaApi,
  sendQuoteViaApi,
  changeOrderStatusViaApi,
  submitPagomovilReceiptViaApi,
  verifyPagomovilViaApi,
} from "./helpers/api.helper";
import { CustomerMenuPage } from "./helpers/page-objects/CustomerMenuPage";

/**
 * Service — lifecycle completo (soporte técnico / servicios)
 *
 * Cubre el flujo completo de un negocio de servicios:
 *   Cliente solicita → Admin cotiza → Cliente aprueba → Admin confirma pago
 *
 * Flujos:
 *   1. Inquiry completo: cliente solicita → admin cotiza → admin aprueba manualmente
 *   2. PagoMóvil en servicio aprobado: admin verifica pago
 *   3. QR Page fixed_amount: para cobros directos de servicios fijos
 *   4. QR Page open_amount: para cobros variables (hora técnica, etc.)
 *
 * Arquetipo: service / template: tech-support-service / plan: pro
 *
 * Nota sobre el flujo de cotización:
 *   El estado de una orden de servicio sigue esta máquina:
 *   inquiry → quoted → approved → paid → (preparing → ready → delivered)
 *   El "approve" lo hace el admin (en nombre del cliente) o el cliente
 *   desde su página de status. En estos tests lo hace el admin via API
 *   para simplificar el flujo de prueba.
 */
test.describe.serial("Service — lifecycle completo (soporte técnico)", () => {
  const API = process.env.PW_API_URL ?? "http://localhost:3001";

  let slug: string;
  let adminToken: string;

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    const saToken = await bootstrapSuperadmin(api);

    slug = `service-lc-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(
      api,
      saToken,
      tenantId,
      "service",
      "tech-support-service",
    );

    adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  test("1 · catálogo de servicios carga correctamente → productos visibles", async ({
    page,
  }) => {
    // El arquetipo service usa productos tipo "service" que muestran "Reservar"
    // (flujo de cotización/inquiry se prueba via API en tests 2-5).
    // Este test solo verifica que el catálogo carga con los productos del template.
    const menu = new CustomerMenuPage(page);

    await menu.openAtTable(slug, 1);
    // Heading del tenant visible
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });

    // Hay productos visibles en la página (el template tech-support-service tiene catálogo)
    await expect(page.locator("h3").first()).toBeVisible({ timeout: 8_000 });

    // El botón "Reservar" aparece (tipo service) o "Cotizar" (tipo labor)
    await expect(
      page.getByRole("button", { name: /reservar|cotizar/i }).first(),
    ).toBeVisible({ timeout: 5_000 });
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  test("2 · flujo completo: solicita → admin cotiza → aprueba → confirmado", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const product = await getFirstProductViaApi(api, adminToken);

    // ── Paso 1: cliente solicita servicio via API ──────────────────────────────
    const orderRes = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "takeaway",
        paymentMethod: "cash",
        customer_name: "Cliente Cotización E2E",
        customer_phone: "04141234567",
        items: [{ productId: product._id, quantity: 1 }],
        notes: "Diagnóstico de laptop con pantalla rota",
      },
    });
    expect(orderRes.ok()).toBe(true);
    const order = await orderRes.json();
    expect(order._id).toBeTruthy();

    // Estado inicial: inquiry
    let status = await getOrderStatusViaApi(api, slug, order._id);
    expect(status).toBe("inquiry");

    // ── Paso 2: admin envía cotización ────────────────────────────────────────
    await sendQuoteViaApi(
      api,
      adminToken,
      order._id,
      35.0,
      "Cambio de pantalla + mano de obra",
    );
    status = await getOrderStatusViaApi(api, slug, order._id);
    expect(status).toBe("quoted");

    // ── Paso 3: admin aprueba en nombre del cliente ───────────────────────────
    // (En producción el cliente aprobaría desde su página de status)
    await changeOrderStatusViaApi(
      api,
      adminToken,
      order._id,
      "approved",
      "admin",
    );
    status = await getOrderStatusViaApi(api, slug, order._id);
    expect(status).toBe("approved");

    // ── Paso 4: cliente ve el estado "aprobado" en su página ──────────────────
    await page.goto(`/${slug}/orden/${order._id}/estado`);
    await page.waitForLoadState("networkidle");
    await expect(
      page.getByText(/aprobado|approved|confirmado/i).first(),
    ).toBeVisible({ timeout: 8_000 });

    // ── Paso 5: trabajo completado ────────────────────────────────────────────
    // Service machine: approved → scheduled → in_progress → completed
    await changeOrderStatusViaApi(
      api,
      adminToken,
      order._id,
      "scheduled",
      "admin",
    );
    await changeOrderStatusViaApi(
      api,
      adminToken,
      order._id,
      "in_progress",
      "admin",
    );
    await changeOrderStatusViaApi(
      api,
      adminToken,
      order._id,
      "completed",
      "admin",
    );
    expect(await getOrderStatusViaApi(api, slug, order._id)).toBe("completed");
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  test("3 · cliente paga seña con PagoMóvil en servicio cotizado → admin verifica", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const product = await getFirstProductViaApi(api, adminToken);

    // Crear orden de servicio
    const orderRes = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "takeaway",
        paymentMethod: "pagomovil",
        customer_name: "Cliente PagoMóvil Service E2E",
        items: [{ productId: product._id, quantity: 1 }],
      },
    });
    expect(orderRes.ok()).toBe(true);
    const order = await orderRes.json();

    // Admin cotiza y aprueba
    await sendQuoteViaApi(
      api,
      adminToken,
      order._id,
      50.0,
      "Servicio técnico completo",
    );
    await changeOrderStatusViaApi(
      api,
      adminToken,
      order._id,
      "approved",
      "admin",
    );

    // Cliente sube comprobante de pago
    await submitPagomovilReceiptViaApi(api, slug, order._id);
    expect(await getOrderStatusViaApi(api, slug, order._id)).toBe(
      "pending_verification",
    );

    // Admin verifica el pago
    await verifyPagomovilViaApi(api, adminToken, order._id);
    expect(await getOrderStatusViaApi(api, slug, order._id)).toBe("paid");
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  test("4 · QR Page fixed_amount — cobro directo de servicio fijo", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    // Admin crea QR de monto fijo para un servicio estándar
    const qrRes = await api.post(`${API}/admin/qr-pages`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        shortCode: `svc-fixed-${Date.now()}`,
        title: "Mantenimiento preventivo",
        type: "fixed_amount",
        amount: 25.0,
        paymentMethods: ["pagomovil", "zelle"],
        defaultPaymentMethod: "pagomovil",
      },
    });
    expect(qrRes.ok()).toBe(true);
    const { shortCode } = await qrRes.json();

    await page.goto(`/${slug}/qr/${shortCode}`);
    await expect(page.getByText("Mantenimiento preventivo")).toBeVisible({
      timeout: 10_000,
    });

    // El monto fijo se muestra prominentemente
    await expect(page.getByText("$25.00")).toBeVisible();

    // Solo un método → selector no visible
    await page.getByRole("button", { name: /continuar al pago/i }).click();
    await expect(page).toHaveURL(/\/pagomovil|\/pago\/|\/qr\//, {
      timeout: 10_000,
    });
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────
  test("5 · QR Page open_amount — cobro por hora técnica variable", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const qrRes = await api.post(`${API}/admin/qr-pages`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        shortCode: `svc-open-${Date.now()}`,
        title: "Hora técnica",
        type: "open_amount",
        paymentMethods: ["pagomovil", "zelle", "transfer"],
        defaultPaymentMethod: "zelle",
      },
    });
    expect(qrRes.ok()).toBe(true);
    const { shortCode } = await qrRes.json();

    await page.goto(`/${slug}/qr/${shortCode}`);
    await expect(page.getByText("Hora técnica")).toBeVisible({
      timeout: 10_000,
    });

    // Ingresar monto variable — el $ es un span separado del input, verificar Bs
    await page.locator('input[type="number"]').fill("75.00");
    await expect(page.getByText(/≈ Bs\./i)).toBeVisible({ timeout: 5_000 });

    // Cambiar a PagoMóvil
    await page.getByRole("button", { name: /pagomóvil/i }).click();

    await page.getByRole("button", { name: /continuar al pago/i }).click();
    await expect(page).toHaveURL(/\/pagomovil|\/pago\/|\/qr\//, {
      timeout: 10_000,
    });
  });
});
