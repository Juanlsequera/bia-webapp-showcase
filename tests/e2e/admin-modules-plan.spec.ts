import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  resetDbViaApi,
} from "./helpers/api.helper";
import { AdminLoginPage } from "./helpers/page-objects/AdminLoginPage";

/**
 * Verifica que la restricción de plan funcione correctamente en la pestaña Módulos.
 *
 * Estrategia:
 *  - Crear tenants con plan "starter" y verificar que los módulos Pro-only
 *    aparezcan bloqueados (badge "Pro" + toggle disabled).
 *  - Verificar que los módulos Starter NO estén bloqueados.
 *  - Casos clave de las decisiones recientes:
 *      · qr_pages     → Pro (canal extra de venta, no operación base)
 *      · product_variants → Starter (retail no puede operar sin tallas/colores)
 *      · payment_links    → Starter (booking/service lo usan para señas)
 *
 * Selector de estado bloqueado:
 *   - Badge "Pro": <span> con texto exacto "Pro" dentro del row del módulo
 *   - Toggle disabled: button[role="switch"] con atributo disabled
 *
 * Ver docs/44-modulos-y-planes.md para la tabla completa de plan gates.
 */
test.describe("Admin — módulos: restricciones de plan Starter", () => {
  const PASSWORD = "admin-pw-test123";

  async function setup(
    playwright: any,
    archetype: "food" | "retail" | "booking" | "service",
    plan: "starter" | "pro" = "starter",
  ) {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post("http://localhost:3001/auth/bootstrap");
    const saToken = await bootstrapSuperadmin(api);
    const slug = `${archetype}-plan-e2e-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(
      api,
      saToken,
      tenantId,
      archetype,
      `${archetype}-en-blanco`,
      plan,
    );
    return { slug };
  }

  async function goToModulesTab(page: any, slug: string) {
    await page.goto(`/${slug}/admin/configuracion?tab=modulos`);
    await expect(page.getByText(/Configuración recomendada para/i)).toBeVisible(
      { timeout: 10_000 },
    );
  }

  /** Scope al contenedor de la pestaña Módulos — evita conflictos con sidebar. */
  function modules(page: any) {
    return page.locator('[data-tour="settings-modules"]');
  }

  /** Localiza el row de un módulo por su label exacto.
   *  Usamos :has(button[role="switch"]) para acotar al div raíz del ConfigSwitch
   *  (que contiene tanto el label como el toggle), evitando los divs internos
   *  que tienen el texto pero no el botón como descendiente. */
  function moduleRow(page: any, label: string) {
    const escaped = label.replace(/[$()*+./?[\\\]^{|}]/g, "\\$&");
    return modules(page)
      .locator('div:has(button[role="switch"])')
      .filter({ hasText: new RegExp(escaped) })
      .first();
  }

  /** Asserts que el módulo tiene badge "Pro" y su toggle está deshabilitado. */
  async function expectLocked(page: any, label: string) {
    const row = moduleRow(page, label);
    await expect(row.getByText("Pro", { exact: true })).toBeVisible({
      timeout: 5_000,
    });
    await expect(row.locator('button[role="switch"]')).toBeDisabled();
  }

  /** Asserts que el módulo NO tiene badge "Pro" y su toggle está habilitado. */
  async function expectUnlocked(page: any, label: string) {
    const row = moduleRow(page, label);
    await expect(row.getByText("Pro", { exact: true })).not.toBeVisible();
    await expect(row.locator('button[role="switch"]')).not.toBeDisabled();
  }

  // ── FOOD — plan Starter ───────────────────────────────────────────────────

  test("food Starter — qr_pages y finance_documents bloqueados; KDS y modificadores libres", async ({
    page,
    playwright,
  }) => {
    const { slug } = await setup(playwright, "food", "starter");

    await new AdminLoginPage(page).loginAs(
      slug,
      `${slug}@test.local`,
      PASSWORD,
    );
    await goToModulesTab(page, slug);

    // ── Pro-only aplicables a food — deben estar bloqueados ─────────────────
    await expectLocked(page, "Páginas de cobro QR");
    await expectLocked(page, "Documentos financieros");

    // ── Starter aplicables a food — deben estar libres ──────────────────────
    await expectUnlocked(page, "Pantalla de cocina (KDS)");
    await expectUnlocked(page, "Modificadores / extras");
  });

  // ── RETAIL — plan Starter ─────────────────────────────────────────────────

  test("retail Starter — product_variants y inventory_tracking libres (Starter); qr_pages bloqueado", async ({
    page,
    playwright,
  }) => {
    const { slug } = await setup(playwright, "retail", "starter");

    await new AdminLoginPage(page).loginAs(
      slug,
      `${slug}@test.local`,
      PASSWORD,
    );
    await goToModulesTab(page, slug);

    // ── El caso clave: product_variants es Starter desde la decisión de diseño
    //    de 2026-06-01. Retail no puede operar sin tallas/colores. ────────────
    await expectUnlocked(page, "Variantes de producto");
    await expectUnlocked(page, "Control de inventario");
    await expectUnlocked(page, "Pedidos programados");

    // ── qr_pages sí es Pro-only ──────────────────────────────────────────────
    await expectLocked(page, "Páginas de cobro QR");
    await expectLocked(page, "Documentos financieros");
  });

  // ── BOOKING — plan Starter ────────────────────────────────────────────────

  test("booking Starter — reservas y payment_links libres; qr_pages bloqueado", async ({
    page,
    playwright,
  }) => {
    const { slug } = await setup(playwright, "booking", "starter");

    await new AdminLoginPage(page).loginAs(
      slug,
      `${slug}@test.local`,
      PASSWORD,
    );
    await goToModulesTab(page, slug);

    // ── Core del arquetipo — Starter ─────────────────────────────────────────
    await expectUnlocked(page, "Sistema de reservas");
    await expectUnlocked(page, "Gestión de profesionales");
    // payment_links es Starter para booking (para señas y anticipos)
    await expectUnlocked(page, "Links de pago");

    // ── Pro-only ─────────────────────────────────────────────────────────────
    await expectLocked(page, "Páginas de cobro QR");
    await expectLocked(page, "Documentos financieros");
  });

  // ── SERVICE — plan Starter ────────────────────────────────────────────────

  test("service Starter — cotizaciones y payment_links libres; qr_pages y quotation_builder bloqueados", async ({
    page,
    playwright,
  }) => {
    const { slug } = await setup(playwright, "service", "starter");

    await new AdminLoginPage(page).loginAs(
      slug,
      `${slug}@test.local`,
      PASSWORD,
    );
    await goToModulesTab(page, slug);

    // ── Core del arquetipo — Starter ─────────────────────────────────────────
    await expectUnlocked(page, "Cotizaciones y presupuestos");
    await expectUnlocked(page, "Precios por mano de obra");
    // payment_links es Starter para service (cobros remotos)
    await expectUnlocked(page, "Links de pago");
    await expectUnlocked(page, "Gestión de profesionales");

    // ── Pro-only aplicables a service ────────────────────────────────────────
    await expectLocked(page, "Páginas de cobro QR");
    await expectLocked(page, "Generador de presupuestos PDF");
    await expectLocked(page, "Documentos financieros");
  });

  // ── UPGRADE: Starter → Pro desbloquea qr_pages ───────────────────────────

  test("food Pro — qr_pages NO está bloqueado (unlock post-upgrade)", async ({
    page,
    playwright,
  }) => {
    // Pro plan: qr_pages debería estar libre (sin badge "Pro", toggle habilitado)
    const { slug } = await setup(playwright, "food", "pro");

    await new AdminLoginPage(page).loginAs(
      slug,
      `${slug}@test.local`,
      PASSWORD,
    );
    await goToModulesTab(page, slug);

    await expectUnlocked(page, "Páginas de cobro QR");
    await expectUnlocked(page, "Documentos financieros");
    // Módulos core siguen libres
    await expectUnlocked(page, "Pantalla de cocina (KDS)");
  });
});
