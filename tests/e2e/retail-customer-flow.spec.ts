import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  resetDbViaApi,
} from "./helpers/api.helper";
import { CustomerMenuPage } from "./helpers/page-objects/CustomerMenuPage";

test.describe("Retail — happy path cliente", () => {
  let slug: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post("http://localhost:3001/auth/bootstrap");
    const saToken = await bootstrapSuperadmin(api);
    slug = `retail-e2e-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    // clothing: template con productos físicos (sin variants obligatorias para el happy path)
    await configureTenant(api, saToken, tenantId, "retail", "clothing-store");
  });

  test("cliente navega catálogo retail, agrega al carrito y paga", async ({
    page,
  }) => {
    const menuPage = new CustomerMenuPage(page);

    // Retail: mesa/5 (dine_in) — evita el requisito de customer_name
    // de los modos takeaway/delivery en el CartPage.
    await menuPage.openAtTable(slug, 5);

    // Verificar que se cargó el menú del tenant retail
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });

    // Agregar primer producto disponible
    await menuPage.addFirstProduct();

    // Abrir carrito
    await menuPage.openCart();
    await expect(page.getByText(/total/i)).toBeVisible();

    // Confirmar pago en efectivo
    await menuPage.confirmCashPayment("Cliente Retail E2E");

    // Verificar orden confirmada
    await menuPage.expectOrderConfirmed();
  });
});
