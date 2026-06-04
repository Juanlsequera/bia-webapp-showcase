import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  resetDbViaApi,
} from "./helpers/api.helper";

const SA_EMAIL = process.env.SA_EMAIL ?? "sa@foodorder.dev";
const API = process.env.PW_API_URL ?? "http://localhost:3001";

test.describe("Wizard de onboarding (superadmin)", () => {
  let saToken: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    saToken = await bootstrapSuperadmin(api);
  });

  test("superadmin completa los 5 pasos del wizard para un tenant food", async ({
    page,
    playwright,
  }) => {
    // 1. Crear tenant vía API
    const api = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${saToken}` },
    });
    const tenantId = await createTenantViaApi(
      await playwright.request.newContext(),
      saToken,
      "test-rest-e2e",
    );

    // 2. Prefetch la lista de tenants (para inyectar en el wizard)
    const tenantsRes = await api.get(`${API}/tenants`);
    const tenantsList = await tenantsRes.json();

    // 3. Inyectar auth token en localStorage
    // IMPORTANTE: usar version: 2 y el campo "accessToken" (no "token"),
    // que es el formato actual del store. Con version: 0 el migrate() de
    // zustand/persist limpia el estado y Layout redirige a /login.
    await page.addInitScript(
      ([token, email]) => {
        localStorage.setItem(
          "sa-auth",
          JSON.stringify({
            state: {
              accessToken: token,
              refreshToken: null,
              user: { email, role: "superadmin" },
            },
            version: 2,
          }),
        );
      },
      [saToken, SA_EMAIL],
    );

    // 4. Interceptar llamadas del superadmin al API:
    //    • GET /tenants → fulfillamos con la lista prefetcheada (evita depender de VITE_API_URL)
    //    • Todo lo demás → redirigir a 3001
    await page.route("**", async (route) => {
      const url = route.request().url();
      const meth = route.request().method();

      // GET tenants list → fulfill directo
      if (meth === "GET" && /\/tenants$/.test(url)) {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(tenantsList),
        });
      }

      // Cualquier petición a localhost:3000 → redirigir a 3001
      if (url.includes("localhost:3000")) {
        return route.continue({
          url: url.replace("localhost:3000", "localhost:3001"),
        });
      }

      return route.continue();
    });

    // 5. Navegar al wizard
    await page.goto(`http://localhost:5178/tenants/${tenantId}/onboarding`);
    await page.waitForLoadState("networkidle");

    // Step 1: tipo de negocio
    await page
      .getByRole("button", { name: /restaurante.*comida|food|comida/i })
      .click();
    await page
      .getByRole("button", { name: /continuar|siguiente|next/i })
      .click();

    // Step 2: template
    await page
      .getByRole("button", { name: /restaurante.*qr|restaurant-qr/i })
      .first()
      .click();
    await page
      .getByRole("button", { name: /continuar|siguiente|next/i })
      .click();

    // Step 3: plan — el botón contiene heading "Pro" + precio + features; usar filter
    await page
      .locator("button")
      .filter({ has: page.getByRole("heading", { name: "Pro", level: 3 }) })
      .click();
    await page
      .getByRole("button", { name: /continuar|siguiente|next/i })
      .click();

    // Step 4: módulos (defaults OK)
    await page
      .getByRole("button", { name: /continuar|siguiente|next/i })
      .click();

    // Step 5: confirm + activate — el slug aparece en 3 lugares; usar .first()
    await expect(page.getByText(/test-rest-e2e/i).first()).toBeVisible();
    await page
      .getByRole("button", {
        name: /activar.*negocio|finalizar|confirmar|completar/i,
      })
      .click();

    // Pantalla de éxito
    await expect(
      page.getByText(/negocio activado|onboarded|configurado|activo/i),
    ).toBeVisible({ timeout: 15_000 });
  });
});
