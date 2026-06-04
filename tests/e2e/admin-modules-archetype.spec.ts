import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  resetDbViaApi,
} from "./helpers/api.helper";

/**
 * Verifica que la pestaña Módulos sea archetype-aware para los 4 arquetipos.
 *
 * Estrategia:
 *  - Plan Pro en todos los tests → los módulos Pro-only están desbloqueados
 *    y podemos verificar que sean visibles sin la restricción de plan.
 *  - Template "en-blanco" de cada arquetipo → usa exactamente
 *    ARCHETYPE_MODULE_DEFAULTS sin overrides de template específico.
 *  - Módulos omitidos por no estar implementados aún en UI:
 *    delivery_zones, loyalty_program, coupons_discounts.
 *
 * Para cada arquetipo se verifica:
 *  1. Banner contextual muestra el nombre del arquetipo.
 *  2. Módulos APLICABLES al arquetipo son visibles en la sección principal.
 *  3. Módulos NO APLICABLES están ocultos por defecto.
 *  4. El botón "ver módulos de otros arquetipos" existe y al clickearlo
 *     aparece al menos un módulo que antes estaba oculto.
 *
 * Módulos y sus labels en la UI:
 *   kitchen_kds        → "Pantalla de cocina (KDS)"
 *   product_modifiers  → "Modificadores / extras"
 *   product_variants   → "Variantes de producto"
 *   inventory_tracking → "Control de inventario"
 *   scheduled_orders   → "Pedidos programados"
 *   labor_pricing      → "Precios por mano de obra"
 *   quotes_estimates   → "Cotizaciones y presupuestos"
 *   booking            → "Sistema de reservas"
 *   staff_management   → "Gestión de profesionales"
 *   payment_links      → "Links de pago"
 *   quotation_builder  → "Generador de presupuestos PDF"
 *   finance_documents  → "Documentos financieros"
 *
 * Nota de locators: todas las assertions de módulos se scopean a
 * [data-tour="settings-modules"] para evitar conflictos con items
 * del sidebar que comparten texto similar (ej: sidebar "Links de Pago"
 * vs módulo "Links de pago"). Se usa exact:true para match case-sensitive.
 */
test.describe("Admin — módulos por arquetipo (plan Pro)", () => {
  const PASSWORD = "admin-pw-test123";

  async function setup(
    playwright: any,
    archetype: "food" | "retail" | "booking" | "service",
    templateId: string,
  ) {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post("http://localhost:3001/auth/bootstrap");
    const saToken = await bootstrapSuperadmin(api);
    const slug = `${archetype}-mod-e2e-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    // configureTenant ya usa plan: "pro" por defecto
    await configureTenant(api, saToken, tenantId, archetype, templateId);
    // Obtain admin credentials via API to inject into localStorage (avoids rate-limit / browser login flakiness)
    const loginRes = await api.post("http://localhost:3001/auth/login", {
      data: { email: `${slug}@test.local`, password: PASSWORD },
    });
    const authBody = await loginRes.json();
    if (!authBody.access_token) {
      throw new Error(
        `Admin login in setup failed: ${JSON.stringify(authBody)}`,
      );
    }
    return { slug, api, authBody };
  }

  async function loginAdmin(page: any, authBody: any, slug: string) {
    await page.goto("/admin/login");
    await page.evaluate(
      ({ auth, s }: { auth: any; s: string }) => {
        localStorage.setItem(
          "bia-auth",
          JSON.stringify({
            state: {
              accessToken: auth.access_token,
              refreshToken: auth.refresh_token ?? null,
              user: auth.user,
              tenantSlug: s,
            },
            version: 3,
          }),
        );
        localStorage.setItem(
          "bia-tours",
          JSON.stringify({
            state: { completed: { "settings-modules": true }, snoozed: {} },
            version: 0,
          }),
        );
      },
      { auth: authBody, s: slug },
    );
  }

  async function goToModulesTab(page: any, slug: string) {
    await page.goto(`/${slug}/admin/configuracion?tab=modulos`);
    // Esperar a que el banner contextual esté visible
    await expect(page.getByText(/Configuración recomendada para/i)).toBeVisible(
      { timeout: 10_000 },
    );
  }

  /**
   * Scopa las assertions al contenedor de la pestaña Módulos.
   * Evita que el sidebar (ej: "Links de Pago") interfiera con los
   * labels de módulos (ej: "Links de pago"). Usa exact:true en los
   * getByText para que el match sea case-sensitive.
   */
  function modules(page: any) {
    return page.locator('[data-tour="settings-modules"]');
  }

  // ── FOOD ─────────────────────────────────────────────────────────────────────

  test("food — KDS y modificadores visibles; reservas, cotizaciones y links ocultos", async ({
    page,
    playwright,
  }) => {
    const { slug, authBody } = await setup(
      playwright,
      "food",
      "food-en-blanco",
    );

    await loginAdmin(page, authBody, slug);
    await goToModulesTab(page, slug);

    // Banner nombra el arquetipo
    await expect(page.getByText("Comida").first()).toBeVisible();

    const m = modules(page);

    // ── Módulos aplicables — deben estar visibles ────────────────────────────
    await expect(
      m.getByText("Pantalla de cocina (KDS)", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Modificadores / extras", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Variantes de producto", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Control de inventario", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Documentos financieros", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Páginas de cobro QR", { exact: true }),
    ).toBeVisible();

    // ── Módulos NO aplicables — deben estar ocultos ──────────────────────────
    await expect(
      m.getByText("Sistema de reservas", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Gestión de profesionales", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Cotizaciones y presupuestos", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Precios por mano de obra", { exact: true }),
    ).toHaveCount(0);
    await expect(m.getByText("Links de pago", { exact: true })).toHaveCount(0);
    await expect(
      m.getByText("Generador de presupuestos PDF", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Pedidos programados", { exact: true }),
    ).toHaveCount(0);

    // ── Escape hatch — al expandir aparece un módulo de otro arquetipo ───────
    await page
      .getByRole("button", { name: /ver módulos de otros arquetipos/i })
      .click();
    await expect(
      m.getByText("Sistema de reservas", { exact: true }),
    ).toBeVisible();
    await expect(m.getByText("Links de pago", { exact: true })).toBeVisible();
  });

  // ── RETAIL ───────────────────────────────────────────────────────────────────

  test("retail — variantes e inventario visibles; cocina, reservas y cotizaciones ocultos", async ({
    page,
    playwright,
  }) => {
    const { slug, authBody } = await setup(
      playwright,
      "retail",
      "retail-en-blanco",
    );

    await loginAdmin(page, authBody, slug);
    await goToModulesTab(page, slug);

    // Banner nombra el arquetipo
    await expect(page.getByText("Retail / Tienda").first()).toBeVisible();

    const m = modules(page);

    // ── Módulos aplicables ───────────────────────────────────────────────────
    await expect(
      m.getByText("Variantes de producto", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Control de inventario", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Pedidos programados", { exact: true }),
    ).toBeVisible();
    await expect(m.getByText("Links de pago", { exact: true })).toBeVisible();
    await expect(
      m.getByText("Documentos financieros", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Páginas de cobro QR", { exact: true }),
    ).toBeVisible();

    // ── Módulos NO aplicables ────────────────────────────────────────────────
    await expect(
      m.getByText("Pantalla de cocina (KDS)", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Modificadores / extras", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Sistema de reservas", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Gestión de profesionales", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Cotizaciones y presupuestos", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Precios por mano de obra", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Generador de presupuestos PDF", { exact: true }),
    ).toHaveCount(0);

    // ── Escape hatch ─────────────────────────────────────────────────────────
    await page
      .getByRole("button", { name: /ver módulos de otros arquetipos/i })
      .click();
    await expect(
      m.getByText("Pantalla de cocina (KDS)", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Sistema de reservas", { exact: true }),
    ).toBeVisible();
  });

  // ── BOOKING ──────────────────────────────────────────────────────────────────

  test("booking — reservas y links visibles; cocina, inventario y cotizaciones ocultos", async ({
    page,
    playwright,
  }) => {
    const { slug, authBody } = await setup(
      playwright,
      "booking",
      "booking-en-blanco",
    );

    await loginAdmin(page, authBody, slug);
    await goToModulesTab(page, slug);

    // Banner nombra el arquetipo
    await expect(page.getByText("Reservas").first()).toBeVisible();

    const m = modules(page);

    // ── Módulos aplicables ───────────────────────────────────────────────────
    await expect(
      m.getByText("Sistema de reservas", { exact: true }),
    ).toBeVisible();
    await expect(m.getByText("Links de pago", { exact: true })).toBeVisible();
    await expect(
      m.getByText("Gestión de profesionales", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Documentos financieros", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Páginas de cobro QR", { exact: true }),
    ).toBeVisible();

    // ── Módulos NO aplicables ────────────────────────────────────────────────
    await expect(
      m.getByText("Pantalla de cocina (KDS)", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Modificadores / extras", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Variantes de producto", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Control de inventario", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Pedidos programados", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Cotizaciones y presupuestos", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Precios por mano de obra", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Generador de presupuestos PDF", { exact: true }),
    ).toHaveCount(0);

    // ── Escape hatch ─────────────────────────────────────────────────────────
    await page
      .getByRole("button", { name: /ver módulos de otros arquetipos/i })
      .click();
    await expect(
      m.getByText("Pantalla de cocina (KDS)", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Cotizaciones y presupuestos", { exact: true }),
    ).toBeVisible();
  });

  // ── SERVICE ──────────────────────────────────────────────────────────────────

  test("service — cotizaciones, links y presupuesto visibles; cocina y reservas ocultos", async ({
    page,
    playwright,
  }) => {
    const { slug, authBody } = await setup(
      playwright,
      "service",
      "service-en-blanco",
    );

    await loginAdmin(page, authBody, slug);
    await goToModulesTab(page, slug);

    // Banner nombra el arquetipo
    await expect(page.getByText("Servicios").first()).toBeVisible();

    const m = modules(page);

    // ── Módulos aplicables ───────────────────────────────────────────────────
    await expect(
      m.getByText("Cotizaciones y presupuestos", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Precios por mano de obra", { exact: true }),
    ).toBeVisible();
    await expect(m.getByText("Links de pago", { exact: true })).toBeVisible();
    await expect(
      m.getByText("Generador de presupuestos PDF", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Gestión de profesionales", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Control de inventario", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Documentos financieros", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Páginas de cobro QR", { exact: true }),
    ).toBeVisible();

    // ── Módulos NO aplicables ────────────────────────────────────────────────
    await expect(
      m.getByText("Pantalla de cocina (KDS)", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Modificadores / extras", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Variantes de producto", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Sistema de reservas", { exact: true }),
    ).toHaveCount(0);
    await expect(
      m.getByText("Pedidos programados", { exact: true }),
    ).toHaveCount(0);

    // ── Escape hatch ─────────────────────────────────────────────────────────
    await page
      .getByRole("button", { name: /ver módulos de otros arquetipos/i })
      .click();
    await expect(
      m.getByText("Pantalla de cocina (KDS)", { exact: true }),
    ).toBeVisible();
    await expect(
      m.getByText("Sistema de reservas", { exact: true }),
    ).toBeVisible();
  });

  // ── CROSS-ARCHETYPE: badges de recomendado ────────────────────────────────

  test("food — kitchen_kds y product_modifiers tienen badge Recomendado", async ({
    page,
    playwright,
  }) => {
    const { slug, authBody } = await setup(
      playwright,
      "food",
      "food-en-blanco",
    );

    await loginAdmin(page, authBody, slug);
    await goToModulesTab(page, slug);

    const m = modules(page);

    // Los módulos recomendados (true en ARCHETYPE_MODULE_DEFAULTS.food)
    // muestran el badge "Recomendado"
    const kdsRow = m
      .locator("div")
      .filter({ hasText: /^Pantalla de cocina \(KDS\)/ })
      .first();
    await expect(kdsRow.getByText("Recomendado")).toBeVisible();

    const modRow = m
      .locator("div")
      .filter({ hasText: /^Modificadores \/ extras/ })
      .first();
    await expect(modRow.getByText("Recomendado")).toBeVisible();
  });

  test("service — quotes_estimates, labor_pricing y payment_links tienen badge Recomendado", async ({
    page,
    playwright,
  }) => {
    const { slug, authBody } = await setup(
      playwright,
      "service",
      "service-en-blanco",
    );

    await loginAdmin(page, authBody, slug);
    await goToModulesTab(page, slug);

    const m = modules(page);

    const quotesRow = m
      .locator("div")
      .filter({ hasText: /^Cotizaciones y presupuestos/ })
      .first();
    await expect(quotesRow.getByText("Recomendado")).toBeVisible();

    const laborRow = m
      .locator("div")
      .filter({ hasText: /^Precios por mano de obra/ })
      .first();
    await expect(laborRow.getByText("Recomendado")).toBeVisible();

    const payRow = m
      .locator("div")
      .filter({ hasText: /^Links de pago/ })
      .first();
    await expect(payRow.getByText("Recomendado")).toBeVisible();
  });

  test("booking — booking y payment_links tienen badge Recomendado", async ({
    page,
    playwright,
  }) => {
    const { slug, authBody } = await setup(
      playwright,
      "booking",
      "booking-en-blanco",
    );

    await loginAdmin(page, authBody, slug);
    await goToModulesTab(page, slug);

    const m = modules(page);

    const bookingRow = m
      .locator("div")
      .filter({ hasText: /^Sistema de reservas/ })
      .first();
    await expect(bookingRow.getByText("Recomendado")).toBeVisible();

    const linksRow = m
      .locator("div")
      .filter({ hasText: /^Links de pago/ })
      .first();
    await expect(linksRow.getByText("Recomendado")).toBeVisible();
  });

  test("retail — product_variants e inventory_tracking tienen badge Recomendado", async ({
    page,
    playwright,
  }) => {
    const { slug, authBody } = await setup(
      playwright,
      "retail",
      "retail-en-blanco",
    );

    await loginAdmin(page, authBody, slug);
    await goToModulesTab(page, slug);

    const m = modules(page);

    const variantsRow = m
      .locator("div")
      .filter({ hasText: /^Variantes de producto/ })
      .first();
    await expect(variantsRow.getByText("Recomendado")).toBeVisible();

    const inventoryRow = m
      .locator("div")
      .filter({ hasText: /^Control de inventario/ })
      .first();
    await expect(inventoryRow.getByText("Recomendado")).toBeVisible();
  });
});
