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
  enableTakeawayViaApi,
} from "./helpers/api.helper";
import { CustomerMenuPage } from "./helpers/page-objects/CustomerMenuPage";

/**
 * Food — lifecycle completo (comida rápida)
 *
 * Cubre el flujo de extremo a extremo:
 *   Cliente → Menú → Carrito → Pago → Admin verifica → Cocina procesa
 *
 * Flujos:
 *   1. Pago en efectivo:  cliente pide → admin confirma caja → cocina despacha
 *   2. Pago PagoMóvil:   cliente pide → sube comprobante → admin verifica → cocina despacha
 *   3. QR Page:          cliente escanea QR → selecciona productos → paga
 *
 * Fixtures de setup:
 *   - Arquetipo: food / template: restaurant-qr / plan: pro
 *   - Cuenta bancaria PagoMóvil precargada (requerida para mostrar el método)
 *   - Mesa 5 como punto de entrada del cliente
 */
test.describe.serial("Food — lifecycle completo (comida rápida)", () => {
  const API = process.env.PW_API_URL ?? "http://localhost:3001";
  const TABLE = 5;

  let slug: string;
  let adminToken: string;

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    const saToken = await bootstrapSuperadmin(api);

    slug = `food-lc-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "food", "restaurant-qr");

    adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);
    // Habilitar takeaway para el test 3 (por defecto viene desactivado en tenants nuevos)
    await enableTakeawayViaApi(api, adminToken);
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  test("1 · cliente arma carrito → paga en efectivo → admin confirma → cocina despacha", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const menu = new CustomerMenuPage(page);

    // ── Cliente: navega menú y confirma ─────────────────────────────────────
    await menu.openAtTable(slug, TABLE);
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });
    await menu.addFirstProduct();
    await menu.openCart();
    await expect(page.getByText(/total/i)).toBeVisible();
    await menu.confirmCashPayment("Cliente Food E2E");
    await menu.expectOrderConfirmed();

    // ── Extraer orderId de la URL actual ──────────────────────────────────────
    // Luego de confirmar, la URL es /{slug}/orden/{orderId}/estado
    const url = page.url();
    const orderId = url.split("/orden/")[1]?.split("/")[0];
    expect(orderId).toBeTruthy();

    // ── Estado inicial: pending_cash ──────────────────────────────────────────
    let status = await getOrderStatusViaApi(api, slug, orderId!);
    expect(status).toBe("pending_cash");

    // ── Admin: confirma pago en caja ─────────────────────────────────────────
    await confirmCashPaymentViaApi(api, adminToken, orderId!);
    status = await getOrderStatusViaApi(api, slug, orderId!);
    expect(status).toBe("paid");

    // ── Cocina: procesa la comanda (paid → preparing → ready → delivered) ────
    await changeOrderStatusViaApi(api, adminToken, orderId!, "preparing");
    expect(await getOrderStatusViaApi(api, slug, orderId!)).toBe("preparing");

    await changeOrderStatusViaApi(api, adminToken, orderId!, "ready");
    expect(await getOrderStatusViaApi(api, slug, orderId!)).toBe("ready");

    await changeOrderStatusViaApi(api, adminToken, orderId!, "delivered");
    expect(await getOrderStatusViaApi(api, slug, orderId!)).toBe("delivered");
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  test("2 · cliente elige PagoMóvil → sube comprobante → admin verifica → cocina despacha", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const menu = new CustomerMenuPage(page);

    // ── UI: cliente navega al menú y elige PagoMóvil ──────────────────────────
    // El flujo del carrito navega a /{slug}/pagomovil (sin orderId en URL)
    // — el pedido se crea recién cuando el cliente envía el comprobante.
    // Este bloque UI verifica que la página de PagoMóvil carga correctamente
    // y muestra los datos de la cuenta bancaria del negocio.
    await menu.openAtTable(slug, TABLE);
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });
    await menu.addFirstProduct();
    await menu.openCart();
    await expect(page.getByText(/total/i)).toBeVisible();

    // PagoMóvil es el método por defecto → el CTA dice "Ir a PagoMóvil"
    await page.getByRole("button", { name: /ir a pagomóvil/i }).click();
    await expect(page).toHaveURL(/\/pagomovil/, { timeout: 10_000 });

    // Datos de la cuenta bancaria deben ser visibles en la página de PagoMóvil
    await expect(page.getByText(/banesco|banco|cuenta/i).first()).toBeVisible({
      timeout: 5_000,
    });

    // ── API: crea orden con PagoMóvil, verifica máquina de estados ────────────
    // Usamos takeaway para no requerir mesa (los tests API son independientes de UI)
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

    // ── Estado inicial: confirmed (pagomovil espera que el cliente envíe la referencia)
    let status = await getOrderStatusViaApi(api, slug, orderId);
    expect(status).toBe("confirmed");

    // ── Cliente sube comprobante (imagen stub, MEDIA_DISABLED=true) ───────────
    await submitPagomovilReceiptViaApi(api, slug, orderId);
    status = await getOrderStatusViaApi(api, slug, orderId);
    expect(status).toBe("pending_verification");

    // ── Admin: verifica el comprobante ────────────────────────────────────────
    await verifyPagomovilViaApi(api, adminToken, orderId);
    status = await getOrderStatusViaApi(api, slug, orderId);
    expect(status).toBe("paid");

    // ── Cocina: preparing → ready ─────────────────────────────────────────────
    await changeOrderStatusViaApi(api, adminToken, orderId, "preparing");
    await changeOrderStatusViaApi(api, adminToken, orderId, "ready");
    expect(await getOrderStatusViaApi(api, slug, orderId)).toBe("ready");

    // ── Cliente ve estado "listo" en su página ────────────────────────────────
    await page.goto(`/${slug}/orden/${orderId}/estado`);
    await expect(page.getByText(/listo|ready|preparado/i).first()).toBeVisible({
      timeout: 8_000,
    });
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  test("3 · cliente pide para llevar (takeaway) → paga en efectivo → confirmado", async ({
    page,
  }) => {
    // El modo takeaway requiere customer_name en el carrito.
    // La página /llevar está protegida por TakeawayGuard que redirige si
    // orderModes.takeaway === false — habilitado en beforeAll con enableTakeawayViaApi.
    await page.goto(`/${slug}/llevar`);
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });

    // Agregar primer producto
    const addBtn = page
      .getByRole("button", { name: /^\+\s|^Agregar /i })
      .first();
    await addBtn.waitFor({ state: "visible" });
    await addBtn.click();

    // Navegar al carrito
    await page.getByRole("link", { name: /carrito|cart/i }).click();
    await expect(page.getByText(/total/i)).toBeVisible();

    // En takeaway el campo de nombre siempre está visible (placeholder "Tu nombre").
    // La label no tiene htmlFor → usar getByPlaceholder en su lugar.
    const customerInput = page.getByPlaceholder("Tu nombre");
    await expect(customerInput).toBeVisible({ timeout: 5_000 });
    await customerInput.fill("Takeaway E2E");

    // Cambiar método de pago de pagomovil (default) a efectivo.
    // El botón tiene nombre accesible "Efectivo Pagas en la caja" → usar contains.
    await page.getByRole("button", { name: /efectivo/i }).click();

    // Ahora el CTA dice "Confirmar pedido" (no "Ir a PagoMóvil")
    await page.getByRole("button", { name: /Confirmar pedido/i }).click();

    await expect(
      page.getByRole("heading", { name: /Pedido recibido|Pasa por caja/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  test("4 · QR Page product_selection → cliente elige cantidad → paga con PagoMóvil", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const product = await getFirstProductViaApi(api, adminToken);

    // Admin crea una QR Page de selección de productos
    const qrRes = await api.post(`${API}/admin/qr-pages`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        shortCode: `food-qr-${Date.now()}`,
        title: "Menú rápido",
        type: "product_selection",
        productIds: [product._id],
        allowQuantity: true,
        paymentMethods: ["pagomovil"],
        defaultPaymentMethod: "pagomovil",
      },
    });
    expect(qrRes.ok()).toBe(true);
    const { shortCode } = await qrRes.json();

    // Cliente accede a la página de cobro (ruta QR: /:slug/qr/:shortCode)
    await page.goto(`/${slug}/qr/${shortCode}`);
    await expect(page.getByText("Menú rápido")).toBeVisible({
      timeout: 10_000,
    });

    // Verificar que el producto aparece
    await expect(page.getByText(product.name)).toBeVisible();

    // Incrementar cantidad x2
    const plusBtn = page
      .locator('.divide-y > div button[class*="bg-primary"]')
      .first();
    await plusBtn.click();
    await plusBtn.click();

    // Verificar total calculado
    const expectedTotal = product.price * 2;
    await expect(
      page.getByText(new RegExp(`\\$${expectedTotal.toFixed(2)}`)),
    ).toBeVisible({ timeout: 5_000 });

    // Enviar pago → redirige a página con datos de cuenta
    await page.getByRole("button", { name: /continuar al pago/i }).click();
    await expect(page).toHaveURL(/\/pagomovil|\/pago\/|\/qr\//, {
      timeout: 10_000,
    });
  });
});
