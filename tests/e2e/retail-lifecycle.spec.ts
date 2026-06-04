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
  confirmCashPaymentViaApi,
  verifyPagomovilViaApi,
  submitPagomovilReceiptViaApi,
  changeOrderStatusViaApi,
  enableModulesViaApi,
} from "./helpers/api.helper";
import { CustomerMenuPage } from "./helpers/page-objects/CustomerMenuPage";

/**
 * Retail — lifecycle completo (tienda de ropa)
 *
 * Cubre el flujo completo de una tienda retail:
 *   Cliente → Catálogo → Carrito → Pago → Admin verifica → Despacho
 *
 * Flujos:
 *   1. Pago en efectivo: cliente elige producto → confirma → admin confirma caja
 *   2. Pago PagoMóvil:  cliente elige producto → paga → admin verifica
 *   3. QR Page:         cliente escanea QR → selecciona productos → paga
 *
 * Arquetipo: retail / template: clothing-store / plan: pro
 * Mesa 5 como entrada (dine_in evita requerir customer_name obligatorio).
 */
test.describe.serial("Retail — lifecycle completo (tienda)", () => {
  const API = process.env.PW_API_URL ?? "http://localhost:3001";
  const TABLE = 5;

  let slug: string;
  let adminToken: string;

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    const saToken = await bootstrapSuperadmin(api);

    slug = `retail-lc-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "retail", "clothing-store");

    adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);

    // Habilitar kitchen_kds para poder usar el endpoint de estado de cocina.
    // El template clothing-store no lo incluye por defecto (no es un módulo de retail),
    // pero lo habilitamos en el test para poder ejercer las transiciones de despacho.
    await enableModulesViaApi(api, saToken, tenantId, { kitchen_kds: true });
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  test("1 · cliente elige producto y paga en efectivo → admin confirma caja", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const menu = new CustomerMenuPage(page);

    await menu.openAtTable(slug, TABLE);
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });
    await menu.addFirstProduct();
    await menu.openCart();
    await expect(page.getByText(/total/i)).toBeVisible();
    await menu.confirmCashPayment("Cliente Retail E2E");
    await menu.expectOrderConfirmed();

    // Extraer orderId — URL: /{slug}/orden/{orderId}/estado
    const url = page.url();
    const orderId = url.split("/orden/")[1]?.split("/")[0];
    expect(orderId).toBeTruthy();

    // Estado: pending_cash
    const initial = await getOrderStatusViaApi(api, slug, orderId!);
    expect(initial).toBe("pending_cash");

    // Admin confirma en caja
    await confirmCashPaymentViaApi(api, adminToken, orderId!);
    expect(await getOrderStatusViaApi(api, slug, orderId!)).toBe("paid");

    // Despacho retail: paid → processing → shipped → delivered
    // (la máquina retail usa estados de e-commerce, no los de cocina food)
    await changeOrderStatusViaApi(api, adminToken, orderId!, "processing");
    await changeOrderStatusViaApi(api, adminToken, orderId!, "shipped");
    await changeOrderStatusViaApi(api, adminToken, orderId!, "delivered");
    expect(await getOrderStatusViaApi(api, slug, orderId!)).toBe("delivered");
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  test("2 · cliente paga con PagoMóvil → admin verifica → despacho", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const menu = new CustomerMenuPage(page);

    // ── UI: verificar que la página de PagoMóvil carga correctamente ──────────
    // El flujo del carrito navega a /{slug}/pagomovil (sin orderId).
    // La orden se crea cuando el cliente envía el comprobante.
    await menu.openAtTable(slug, TABLE);
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });
    await menu.addFirstProduct();
    await menu.openCart();
    await expect(page.getByText(/total/i)).toBeVisible();

    // PagoMóvil es el método por defecto → CTA dice "Ir a PagoMóvil"
    await page.getByRole("button", { name: /ir a pagomóvil/i }).click();
    await expect(page).toHaveURL(/\/pagomovil/, { timeout: 10_000 });
    await expect(page.getByText(/banesco|banco|cuenta/i).first()).toBeVisible({
      timeout: 5_000,
    });

    // ── API: crea orden con PagoMóvil, verifica máquina de estados ────────────
    const product = await getFirstProductViaApi(api, adminToken);
    const orderRes = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "dine_in",
        tableNumber: TABLE,
        paymentMethod: "pagomovil",
        items: [{ productId: product._id, quantity: 1 }],
      },
    });
    if (!orderRes.ok()) {
      const errBody = await orderRes.json().catch(() => ({}));
      throw new Error(
        `Order creation failed (${orderRes.status()}): ${JSON.stringify(errBody)}`,
      );
    }
    const order = await orderRes.json();
    const orderId = order._id;
    expect(orderId).toBeTruthy();

    // Estado inicial: confirmed (pagomovil espera que el cliente envíe la referencia)
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe("confirmed");

    // Cliente sube comprobante
    await submitPagomovilReceiptViaApi(api, slug, orderId);
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe(
      "pending_verification",
    );

    // Admin verifica
    await verifyPagomovilViaApi(api, adminToken, orderId);
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe("paid");

    // Despacho retail: paid → processing → shipped
    await changeOrderStatusViaApi(api, adminToken, orderId, "processing");
    await changeOrderStatusViaApi(api, adminToken, orderId, "shipped");
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe("shipped");
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  test("3 · QR Page product_selection → cliente elige productos de tienda → paga", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const product = await getFirstProductViaApi(api, adminToken);

    // Admin crea QR Page para un producto del catálogo retail
    const qrRes = await api.post(`${API}/admin/qr-pages`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        shortCode: `retail-qr-${Date.now()}`,
        title: "Productos destacados",
        type: "product_selection",
        productIds: [product._id],
        allowQuantity: false, // checkbox, no stepper
        paymentMethods: ["pagomovil", "transfer"],
        defaultPaymentMethod: "pagomovil",
      },
    });
    expect(qrRes.ok()).toBe(true);
    const { shortCode } = await qrRes.json();

    // Cliente accede (ruta QR: /:slug/qr/:shortCode)
    await page.goto(`/${slug}/qr/${shortCode}`);
    await expect(page.getByText("Productos destacados")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByText(product.name)).toBeVisible();

    // Seleccionar producto vía checkbox
    const checkbox = page.locator('input[type="checkbox"]').first();
    await expect(checkbox).toBeVisible();
    await checkbox.check();

    // Verificar precio en el subtotal
    await expect(
      page.getByText(new RegExp(`\\$${product.price.toFixed(2)}`)).first(),
    ).toBeVisible();

    // Enviar pago
    await page.getByRole("button", { name: /continuar al pago/i }).click();
    await expect(page).toHaveURL(/\/pagomovil|\/pago\/|\/qr\//, {
      timeout: 10_000,
    });
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  test("4 · QR Page open_amount → cliente ingresa monto libre → paga", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const qrRes = await api.post(`${API}/admin/qr-pages`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        shortCode: `retail-open-${Date.now()}`,
        title: "Abono a cuenta",
        type: "open_amount",
        paymentMethods: ["pagomovil", "transfer"],
        defaultPaymentMethod: "transfer",
      },
    });
    expect(qrRes.ok()).toBe(true);
    const { shortCode } = await qrRes.json();

    await page.goto(`/${slug}/qr/${shortCode}`);
    await expect(page.getByText("Abono a cuenta")).toBeVisible({
      timeout: 10_000,
    });

    // Ingresar monto — el $ es un span separado del input, se verifica el equivalente Bs
    await page.locator('input[type="number"]').fill("45.50");
    await expect(page.getByText(/≈ Bs\./i)).toBeVisible({ timeout: 5_000 });

    // Cambiar método a PagoMóvil
    await page.getByRole("button", { name: /pagomóvil/i }).click();

    await page.getByRole("button", { name: /continuar al pago/i }).click();
    await expect(page).toHaveURL(/\/pagomovil|\/pago\/|\/qr\//, {
      timeout: 10_000,
    });
  });
});
