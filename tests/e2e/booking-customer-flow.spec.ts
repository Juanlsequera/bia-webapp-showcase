import { test, expect, Page } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  resetDbViaApi,
  loginAsTenantAdmin,
  createStaffViaApi,
  addBankAccountViaApi,
  setBookingSettings,
} from "./helpers/api.helper";

// ── Flujo de navegación compartido ────────────────────────────────────────────

/** Paso 1 → selecciona el primer servicio de la lista. */
async function selectFirstService(page: Page) {
  await expect(page.getByText("Elegí un servicio")).toBeVisible({
    timeout: 10_000,
  });
  // Los servicios se renderizan como botones dentro de <main>
  await page.locator("main button").first().click();
}

/** Paso 2 → selecciona "Sin preferencia" o el primer staff listado. */
async function selectStaff(page: Page, sinPreferencia = true) {
  if (sinPreferencia) {
    await expect(page.getByText("Sin preferencia")).toBeVisible({
      timeout: 6_000,
    });
    await page.getByText("Sin preferencia").click();
  } else {
    // El primer botón en main step 2 es "Sin preferencia"; el segundo es un staff real
    const staffBtns = page.locator("main button");
    await expect(staffBtns.nth(1)).toBeVisible({ timeout: 6_000 });
    await staffBtns.nth(1).click();
  }
}

/**
 * Paso 3 → navega al mes siguiente (fechas garantizadas futuras),
 * elige el primer día disponible y el primer horario.
 * Termina haciendo click en "Continuar →".
 */
async function selectDateAndTime(page: Page) {
  await expect(page.getByText("Fecha y hora")).toBeVisible({ timeout: 8_000 });
  await page.waitForLoadState("networkidle");

  // Avanzar al próximo mes (100% fechas futuras)
  await page.getByLabel("Mes siguiente").click();
  await page.waitForLoadState("networkidle");

  // Primer día disponible (no deshabilitado, texto numérico)
  const dayBtn = page
    .locator('button[aria-disabled="false"]')
    .filter({ hasText: /^\d+$/ })
    .first();
  await expect(dayBtn).toBeVisible({ timeout: 8_000 });
  await dayBtn.click();
  await page.waitForLoadState("networkidle");

  // Primer horario disponible (formato HH:MM) — excluir slots deshabilitados
  const slotBtn = page
    .locator("button:not([disabled])")
    .filter({ hasText: /^\d{1,2}:\d{2}$/ })
    .first();
  await expect(slotBtn).toBeVisible({ timeout: 8_000 });
  await slotBtn.click();

  await page.getByRole("button", { name: "Continuar →" }).click();
}

/** Paso 4 → completa nombre y teléfono y avanza al paso 5. */
async function fillCustomerData(page: Page) {
  await expect(page.getByRole("heading", { name: "Tus datos" })).toBeVisible({
    timeout: 5_000,
  });
  await page.getByLabel(/nombre/i).fill("Cliente E2E");
  await page.getByLabel(/teléfono/i).fill("0414-1234567");
  await page.getByRole("button", { name: "Continuar →" }).click();
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe.serial("Booking — flujo cliente v2", () => {
  let slug: string;
  let adminToken: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(
      `${process.env.PW_API_URL ?? "http://localhost:3001"}/auth/bootstrap`,
    );
    const sa = await bootstrapSuperadmin(api);

    slug = `booking-v2-${Date.now()}`;
    const tid = await createTenantViaApi(api, sa, slug);
    await configureTenant(api, sa, tid, "booking", "barbershop");

    // Staff disponible todos los días + cuenta bancaria para PagoMóvil
    adminToken = await loginAsTenantAdmin(api, slug);
    await createStaffViaApi(api, adminToken);
    await addBankAccountViaApi(api, adminToken);
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  test("1 · hero visible + flujo completo con seña PagoMóvil", async ({
    page,
    playwright,
  }) => {
    // Configurar 50% de seña
    const api = await playwright.request.newContext();
    await setBookingSettings(api, adminToken, { deposit_pct: 50 });

    await page.goto(`/${slug}/reservar`);

    // Paso 1 — hero muestra nombre del negocio
    await expect(
      page.locator("h2").filter({ hasText: new RegExp(slug, "i") }),
    ).toBeVisible({ timeout: 10_000 });

    await selectFirstService(page);
    await selectStaff(page);
    await selectDateAndTime(page);
    await fillCustomerData(page);

    // Paso 5 — resumen con seña del 50%
    await expect(page.getByText(/seña \(50%\)/i)).toBeVisible({
      timeout: 6_000,
    });

    // Click en PagoMóvil → capturar respuesta del POST /orders para diagnóstico
    const orderResponsePromise = page.waitForResponse(
      (r) => r.url().includes("/orders") && r.request().method() === "POST",
      { timeout: 10_000 },
    );
    await page.getByRole("button", { name: /pagomóvil/i }).click();
    const orderResponse = await orderResponsePromise;
    if (!orderResponse.ok()) {
      const body = await orderResponse.json().catch(() => ({}));
      throw new Error(
        `POST /orders failed ${orderResponse.status()}: ${JSON.stringify(body)}`,
      );
    }
    await expect(page).toHaveURL(/\/pagomovil/, { timeout: 10_000 });
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  test("2 · flujo sin seña llega a página de confirmación", async ({
    page,
  }) => {
    // deposit_pct es 0 por defecto — no necesita setBookingSettings

    await page.goto(`/${slug}/reservar`);
    await selectFirstService(page);
    await selectStaff(page);
    await selectDateAndTime(page);
    await fillCustomerData(page);

    // Paso 5 — botón de confirmación directa (sin seña)
    const confirmBtn = page.getByRole("button", {
      name: /confirmar reserva sin seña/i,
    });
    await expect(confirmBtn).toBeVisible({ timeout: 6_000 });
    await confirmBtn.click();

    // Debe llegar a /:slug/reserva/:orderId/confirmado
    await expect(page).toHaveURL(/\/reserva\/.+\/confirmado/, {
      timeout: 15_000,
    });
    await expect(page.getByText("¡Solicitud enviada!")).toBeVisible();
    await expect(page.getByText(/pendiente de confirmación/i)).toBeVisible();

    // Sin seña — "Seña pagada" NO debe aparecer
    await expect(page.getByText(/seña pagada/i)).not.toBeVisible();
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  test("3 · calendario visual — no usa input nativo y la navegación de mes funciona", async ({
    page,
  }) => {
    await page.goto(`/${slug}/reservar`);
    await selectFirstService(page);
    await selectStaff(page);

    // Paso 3 — el calendario es un componente propio, no <input type="date">
    await expect(page.getByText("Fecha y hora")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.locator('input[type="date"]')).toHaveCount(0);

    // Los botones de navegación del calendario deben estar presentes
    await expect(page.getByLabel("Mes siguiente")).toBeVisible();
    await expect(page.getByLabel("Mes anterior")).toBeVisible();

    // Capturar el label del mes actual (es un <p> capitalize con año)
    const header = page.locator(
      'div[aria-label="Calendario de disponibilidad"] p',
    );
    const initialMonth = await header.textContent();

    // Navegar al mes siguiente
    await page.getByLabel("Mes siguiente").click();
    await page.waitForLoadState("networkidle");

    // El header de mes cambió
    const nextMonth = await header.textContent();
    expect(nextMonth).not.toBe(initialMonth);

    // Navegar de vuelta al mes anterior
    await page.getByLabel("Mes anterior").click();
    await page.waitForLoadState("networkidle");

    const backMonth = await header.textContent();
    expect(backMonth).toBe(initialMonth);
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  test('4 · flujo con "sin preferencia" de profesional completa la reserva', async ({
    page,
  }) => {
    await page.goto(`/${slug}/reservar`);
    await selectFirstService(page);

    // Paso 2 — elegir explícitamente "Sin preferencia"
    await expect(page.getByText("Sin preferencia")).toBeVisible({
      timeout: 6_000,
    });
    await page.getByText("Sin preferencia").click();

    await selectDateAndTime(page);
    await fillCustomerData(page);

    // Paso 5 — confirmar directamente (sin seña, método cash)
    const confirmBtn = page.getByRole("button", {
      name: /confirmar reserva sin seña/i,
    });
    await expect(confirmBtn).toBeVisible({ timeout: 6_000 });
    await confirmBtn.click();

    // Verificar que se creó la reserva y llegamos a confirmación
    await expect(page).toHaveURL(/\/reserva\/.+\/confirmado/, {
      timeout: 15_000,
    });
    await expect(page.getByText("¡Solicitud enviada!")).toBeVisible();
  });
});

// ── Tests de admin (sin cambios respecto a la versión anterior) ────────────────

test.describe
  .serial("Booking — admin agenda: confirmar, iniciar, completar", () => {
  let slug: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(
      `${process.env.PW_API_URL ?? "http://localhost:3001"}/auth/bootstrap`,
    );
    const sa = await bootstrapSuperadmin(api);
    slug = `booking-admin-${Date.now()}`;
    const tid = await createTenantViaApi(api, sa, slug);
    await configureTenant(api, sa, tid, "booking", "barbershop");
  });

  test("admin puede ver agenda y usar botones de acción de estado", async ({
    page,
  }) => {
    await page.goto("/admin/login");
    await page.getByLabel(/email|correo/i).fill(`${slug}@test.local`);
    await page.getByLabel(/contraseña|password/i).fill("admin-pw-test123");
    await page.getByRole("button", { name: /entrar|iniciar|login/i }).click();
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith(`/${slug}/admin`) &&
        !url.pathname.includes("login"),
      { timeout: 10_000 },
    );

    await page.goto(`/${slug}/admin/agenda`);
    await page.waitForLoadState("networkidle");

    await expect(page.locator('input[type="date"]')).toBeVisible({
      timeout: 8_000,
    });

    const confirmBtn = page.getByRole("button", { name: /confirmar/i }).first();
    const hasConfirmBtn = await confirmBtn
      .isVisible({ timeout: 2_000 })
      .catch(() => false);
    if (hasConfirmBtn) {
      await confirmBtn.click();
      await page.waitForLoadState("networkidle");
      await expect(
        page.getByRole("button", { name: /iniciar|atención/i }).first(),
      ).toBeVisible({ timeout: 5_000 });
    }
  });
});

test.describe.serial("Booking — reprogramar y cancelar", () => {
  let slug: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(
      `${process.env.PW_API_URL ?? "http://localhost:3001"}/auth/bootstrap`,
    );
    const sa = await bootstrapSuperadmin(api);
    slug = `bk-rs-${Date.now()}`;
    const tid = await createTenantViaApi(api, sa, slug);
    await configureTenant(api, sa, tid, "booking", "barbershop");
  });

  test("admin puede acceder a opciones de reprogramar y cancelar en agenda", async ({
    page,
  }) => {
    await page.goto("/admin/login");
    await page.getByLabel(/email|correo/i).fill(`${slug}@test.local`);
    await page.getByLabel(/contraseña|password/i).fill("admin-pw-test123");
    await page.getByRole("button", { name: /entrar|iniciar|login/i }).click();
    await page.waitForURL(
      (url) =>
        url.pathname.startsWith(`/${slug}/admin`) &&
        !url.pathname.includes("login"),
      { timeout: 10_000 },
    );

    await page.goto(`/${slug}/admin/agenda`);
    await page.waitForLoadState("networkidle");

    const moreBtn = page.getByRole("button", { name: "⋯" }).first();
    const hasMoreBtn = await moreBtn
      .isVisible({ timeout: 2_000 })
      .catch(() => false);

    if (hasMoreBtn) {
      await moreBtn.click();
      await expect(page.getByText(/reprogramar/i)).toBeVisible({
        timeout: 3_000,
      });
      await expect(page.getByText(/cancelar cita/i)).toBeVisible({
        timeout: 1_000,
      });

      await page.getByText(/cancelar cita/i).click();
      await expect(
        page.getByRole("heading", { name: /cancelar cita/i }),
      ).toBeVisible({ timeout: 3_000 });

      await page
        .getByRole("button", { name: /cancelar cita/i })
        .last()
        .click();
      await page.waitForLoadState("networkidle");
      await expect(page.getByText(/cancelado/i)).toBeVisible({
        timeout: 5_000,
      });
    }
  });
});
