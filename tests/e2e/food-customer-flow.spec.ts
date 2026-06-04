import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  resetDbViaApi,
} from "./helpers/api.helper";
import { CustomerMenuPage } from "./helpers/page-objects/CustomerMenuPage";

test.describe("Food — happy path cliente", () => {
  let slug: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    // Bootstrap superadmin tras reset
    await api.post("http://localhost:3001/auth/bootstrap");
    const sa = await bootstrapSuperadmin(api);
    slug = `food-e2e-${Date.now()}`;
    const tid = await createTenantViaApi(api, sa, slug);
    await configureTenant(api, sa, tid, "food", "restaurant-qr");
  });

  test("cliente entra a la mesa, arma carrito, paga en efectivo y ve estado", async ({
    page,
  }) => {
    const menuPage = new CustomerMenuPage(page);

    // Abrir menú en mesa 5
    await menuPage.openAtTable(slug, 5);

    // Verificar que se cargó el menú (algún heading visible)
    await expect(page.getByRole("heading").first()).toBeVisible({
      timeout: 10_000,
    });

    // Agregar primer producto
    await menuPage.addFirstProduct();

    // Abrir carrito
    await menuPage.openCart();
    await expect(page.getByText(/total/i)).toBeVisible();

    // Confirmar pago en efectivo
    await menuPage.confirmCashPayment("Cliente E2E");

    // Ver confirmación de orden
    await menuPage.expectOrderConfirmed();
  });
});
