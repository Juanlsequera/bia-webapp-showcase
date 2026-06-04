import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  loginAsTenantAdmin,
  addBankAccountViaApi,
  createStaffViaApi,
  resetDbViaApi,
} from "./helpers/api.helper";

/**
 * Booking — Agenda del admin (Test I)
 *
 * Cubre las 3 acciones disponibles desde el panel /:slug/admin/agenda:
 *
 *   I.1 · No show:
 *         Admin abre menú "⋯" → "No se presentó" → badge cambia a "No se presentó".
 *
 *   I.2 · Cancelar cita:
 *         Admin abre menú "⋯" → "Cancelar cita" → modal con motivo →
 *         "Cancelar cita" → badge "Cancelado".
 *
 *   I.3 · Reprogramar:
 *         Admin abre menú "⋯" → "Reprogramar" → modal con nueva fecha →
 *         "Confirmar" → badge "Reprogramado".
 *
 * Setup: tenant booking/barbershop con 1 staff y 3 reservas para el 2026-09-15
 * (una por cada acción). Los tests corren en serie (beforeAll comparte estado).
 *
 * Nota: la acción "No se presentó" usa PATCH /admin/orders/:id/status {status:"no_show"}.
 * "Cancelar" usa POST /:slug/orders/:id/cancel-booking (con JWT admin → bypass token).
 * "Reprogramar" usa POST /:slug/orders/:id/reschedule.
 */
test.describe.serial("Booking Admin Agenda — acciones UI", () => {
  const API = process.env.PW_API_URL ?? "http://localhost:3001";
  const BOOKING_DATE = "2026-09-15"; // fecha usada en el date-picker de la agenda

  let slug: string;
  let adminToken: string;

  // Nombres únicos para identificar cada reserva en la UI
  const NAMES = {
    noShow: "Cliente No Show E2E",
    cancel: "Cliente Cancelar E2E",
    reschedule: "Cliente Reprogramar E2E",
  };

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    const saToken = await bootstrapSuperadmin(api);

    slug = `agenda-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "booking", "barbershop");

    adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);
    const staffId = await createStaffViaApi(api, adminToken);

    // Obtener un servicio del catálogo
    const servicesRes = await api.get(`${API}/admin/products`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const servicesBody = await servicesRes.json();
    const services = Array.isArray(servicesBody)
      ? servicesBody
      : (servicesBody.items ?? []);
    if (!services.length) throw new Error("No hay servicios en el tenant");
    const serviceId = services[0]._id as string;

    // Crear 3 reservas en slots distintos del 2026-09-15 (UTC)
    // 13:00 UTC = 09:00 VE / 14:00 UTC = 10:00 VE / 15:00 UTC = 11:00 VE
    const slots = [
      "2026-09-15T13:00:00Z", // no_show
      "2026-09-15T14:00:00Z", // cancel
      "2026-09-15T15:00:00Z", // reschedule
    ];
    const customerNames = [NAMES.noShow, NAMES.cancel, NAMES.reschedule];

    for (let i = 0; i < 3; i++) {
      const res = await api.post(`${API}/${slug}/orders`, {
        data: {
          orderType: "takeaway",
          paymentMethod: "cash",
          customer_name: customerNames[i],
          archetype: "booking",
          staffId,
          bookingDatetime: slots[i],
          items: [{ productId: serviceId, quantity: 1 }],
        },
      });
      if (!res.ok()) {
        const b = await res.json().catch(() => ({}));
        throw new Error(
          `createBooking[${i}] failed (${res.status()}): ${JSON.stringify(b)}`,
        );
      }
    }
  });

  // ── Helper de login admin ──────────────────────────────────────────────────

  async function loginAdmin(page: any) {
    await page.goto("/admin/login");
    await page.getByLabel(/email/i).fill(`${slug}@test.local`);
    await page.getByLabel(/contraseña/i).fill("admin-pw-test123");
    await page.getByRole("button", { name: /iniciar sesión/i }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/admin`), {
      timeout: 10_000,
    });
  }

  /** Navega a la agenda y establece la fecha de prueba en el datepicker. */
  async function openAgendaOnDate(page: any) {
    await page.goto(`/${slug}/admin/agenda`);
    await page.waitForLoadState("networkidle");
    // Establecer la fecha en el input[type="date"]
    await page.locator('input[type="date"]').fill(BOOKING_DATE);
    // Esperar a que se carguen los bookings
    await page.waitForLoadState("networkidle");
    // Verificar que la agenda tiene al menos un booking visible
    await expect(page.getByText(NAMES.noShow)).toBeVisible({ timeout: 10_000 });
  }

  // ── I.1 · No show ─────────────────────────────────────────────────────────

  test("I.1 · no show — badge cambia a 'No se presentó'", async ({ page }) => {
    await loginAdmin(page);
    await openAgendaOnDate(page);

    // Localizar la fila del cliente "No Show E2E" y abrir el menú ⋯
    const row = page
      .locator("div.divide-y > div, .divide-y > div")
      .filter({ hasText: NAMES.noShow })
      .first();

    // Hacer hover/click en el botón ⋯ para abrir el menú desplegable
    await row.getByRole("button", { name: "⋯" }).click();

    // Esperar a que el dropdown sea visible antes de hacer click
    const noShowBtn = page.getByRole("button", { name: /no se presentó/i });
    await expect(noShowBtn).toBeVisible({ timeout: 3_000 });
    await noShowBtn.click();

    // Badge cambia a "No se presentó"
    await expect(row.getByText("No se presentó")).toBeVisible({
      timeout: 8_000,
    });
  });

  // ── I.2 · Cancelar ────────────────────────────────────────────────────────

  test("I.2 · cancelar cita — modal → badge Cancelado", async ({ page }) => {
    await loginAdmin(page);
    await openAgendaOnDate(page);

    const row = page
      .locator("div.divide-y > div, .divide-y > div")
      .filter({ hasText: NAMES.cancel })
      .first();

    // Abrir menú ⋯
    await row.getByRole("button", { name: "⋯" }).click();

    // Click "Cancelar cita"
    await page.getByRole("button", { name: /cancelar cita/i }).click();

    // Modal "Cancelar cita" aparece
    await expect(page.getByText("¿Estás seguro")).toBeVisible({
      timeout: 5_000,
    });

    // Rellenar motivo (opcional)
    await page
      .locator('input[placeholder="Ej: Cliente no se presentó"]')
      .fill("Cancelado en test E2E");

    // Confirmar cancelación — botón dentro del modal
    const confirmBtn = page
      .locator(".fixed button")
      .filter({ hasText: /cancelar cita/i });
    await confirmBtn.click();

    // Badge cambia a "Cancelado"
    await expect(row.getByText("Cancelado")).toBeVisible({ timeout: 8_000 });

    // El modal se cierra
    await expect(page.getByText("¿Estás seguro")).toBeHidden({
      timeout: 5_000,
    });
  });

  // ── I.3 · Reprogramar ─────────────────────────────────────────────────────

  test("I.3 · reprogramar — modal → nueva fecha → badge Reprogramado", async ({
    page,
  }) => {
    await loginAdmin(page);
    await openAgendaOnDate(page);

    const row = page
      .locator("div.divide-y > div, .divide-y > div")
      .filter({ hasText: NAMES.reschedule })
      .first();

    // Abrir menú ⋯
    await row.getByRole("button", { name: "⋯" }).click();

    // Click "Reprogramar"
    await page.getByRole("button", { name: /reprogramar/i }).click();

    // Modal "Reprogramar cita" aparece
    await expect(page.getByText("Reprogramar cita")).toBeVisible({
      timeout: 5_000,
    });

    // Cambiar la fecha/hora en el input datetime-local.
    // IMPORTANTE: usar la MISMA fecha (2026-09-15) para que el booking siga
    // visible en la vista del día activo. Si cambia de día, el listado del
    // admin no lo mostrará y el badge "Reprogramado" no sería encontrado.
    const newDatetime = "2026-09-15T16:00";
    await page.locator('input[type="datetime-local"]').fill(newDatetime);

    // Confirmar reprogramación — escopar al modal para evitar el botón "Confirmar"
    // que puede aparecer en las filas de la agenda detrás del overlay
    await page
      .locator("div.fixed.inset-0")
      .getByRole("button", { name: "Confirmar" })
      .click();

    // El modal se cierra y el badge cambia a "Reprogramado"
    await expect(page.getByText("Reprogramado")).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.getByText("Reprogramar cita")).toBeHidden({
      timeout: 5_000,
    });
  });
});
