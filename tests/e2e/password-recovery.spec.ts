import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  loginAsTenantAdmin,
  resetDbViaApi,
} from "./helpers/api.helper";

/**
 * Password Recovery — Test J
 *
 * Flujo de recuperación de contraseña desde el panel admin.
 * El backend aplica anti-enumeración: SIEMPRE responde 200 aunque el email
 * no exista, y el código NUNCA aparece en la respuesta de la API (solo en email/consola).
 *
 *   J.1 · ForgotPasswordPage — email existente → "Código enviado":
 *         Navega a /:slug/admin/forgot-password → llena email → "Enviar código"
 *         → banner "Código enviado" con link "Ingresar código".
 *
 *   J.2 · ForgotPasswordPage — anti-enumeración:
 *         Mismo flujo con email que NO existe → también muestra "Código enviado"
 *         (nunca un error tipo "usuario no encontrado").
 *
 *   J.3 · ResetPasswordPage — código inválido → error:
 *         Navega a /:slug/admin/reset-password → llena email + código inventado
 *         + nueva contraseña → "Restablecer contraseña" → mensaje de error
 *         "Código inválido".
 *
 *   J.4 · ResetPasswordPage — flujo exitoso (mocked):
 *         Mockea POST /auth/reset-password → 200 para poder ejercer el happy
 *         path sin necesitar el código real. Verifica "Contraseña actualizada"
 *         y la redirección posterior a /admin/login.
 *
 * Nota: el test J.4 usa page.route() para mockear el endpoint de reset.
 * Los tests J.1–J.3 golpean el backend real.
 */
test.describe("Password Recovery — Flujo completo UI", () => {
  const API = process.env.PW_API_URL ?? "http://localhost:3001";

  let slug: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    const saToken = await bootstrapSuperadmin(api);

    slug = `pw-rec-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "food", "restaurant-qr");
    // loginAsTenantAdmin hace el primer login, lo que confirma que la cuenta existe
    await loginAsTenantAdmin(api, slug);
  });

  // ── J.1 · Email existente → "Código enviado" ──────────────────────────────

  test("J.1 · forgot-password con email válido muestra 'Código enviado'", async ({
    page,
  }) => {
    await page.goto(`/${slug}/admin/forgot-password`);
    await page.waitForLoadState("networkidle");

    // Heading de la página
    await expect(page.getByText("Recuperar contraseña")).toBeVisible({
      timeout: 5_000,
    });

    // Llenar email del admin del tenant
    await page.getByLabel(/email/i).fill(`${slug}@test.local`);

    // Click "Enviar código"
    await page.getByRole("button", { name: /enviar código/i }).click();

    // El backend siempre devuelve 200 → UI muestra "Código enviado"
    await expect(page.getByText("Código enviado")).toBeVisible({
      timeout: 8_000,
    });

    // El mensaje informativo aparece
    await expect(page.getByText(/recibirás un código/i)).toBeVisible({
      timeout: 3_000,
    });

    // Link para ir a la página de reset
    await expect(
      page.getByRole("link", { name: /ingresar código/i }),
    ).toBeVisible({ timeout: 3_000 });
  });

  // ── J.2 · Anti-enumeración (email inexistente) ────────────────────────────

  test("J.2 · forgot-password con email inexistente también muestra 'Código enviado' (anti-enum)", async ({
    page,
  }) => {
    await page.goto(`/${slug}/admin/forgot-password`);
    await page.waitForLoadState("networkidle");

    // Email que NO existe en la base de datos
    await page.getByLabel(/email/i).fill("nadie-existe@noexiste.dev");
    await page.getByRole("button", { name: /enviar código/i }).click();

    // Anti-enumeración: el backend devuelve 200 igualmente
    await expect(page.getByText("Código enviado")).toBeVisible({
      timeout: 8_000,
    });

    // NUNCA debe aparecer un error "usuario no encontrado" o similar
    await expect(
      page.getByText(/no encontrad|not found|usuario.*exist/i),
    ).toHaveCount(0);
  });

  // ── J.3 · Código inválido → error visible ─────────────────────────────────

  test("J.3 · reset-password con código incorrecto muestra error 'Código inválido'", async ({
    page,
  }) => {
    await page.goto(`/${slug}/admin/reset-password`);
    await page.waitForLoadState("networkidle");

    // Heading de la página
    await expect(
      page.getByRole("heading", { name: "Restablecer contraseña" }),
    ).toBeVisible({
      timeout: 5_000,
    });

    // Llenar todos los campos con datos inválidos
    await page.getByLabel(/email/i).fill(`${slug}@test.local`);
    await page.getByLabel(/código/i).fill("000000"); // código inventado (6 dígitos)
    await page.getByLabel(/^nueva contraseña/i).fill("NuevaPass123!");
    await page.getByLabel(/confirmar/i).fill("NuevaPass123!");

    // El botón debe estar habilitado (todos los campos llenos y contraseñas coinciden)
    const resetBtn = page.getByRole("button", {
      name: /restablecer contraseña/i,
    });
    await expect(resetBtn).toBeEnabled({ timeout: 3_000 });
    await resetBtn.click();

    // El backend rechaza el código inválido → error visible
    await expect(
      page.getByText(/código inválido|expirado|demasiados intentos/i),
    ).toBeVisible({ timeout: 8_000 });

    // No debe haber redirigido a login
    await expect(page).toHaveURL(new RegExp("reset-password"));
  });

  // ── J.4 · Flujo exitoso (mocked) → "Contraseña actualizada" ──────────────

  test("J.4 · reset-password exitoso (mocked) → 'Contraseña actualizada' + redirect a login", async ({
    page,
  }) => {
    // Mockear el endpoint de reset-password para devolver éxito sin código real
    await page.route("**/auth/reset-password", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ message: "Password reset successfully" }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto(`/${slug}/admin/reset-password`);
    await page.waitForLoadState("networkidle");

    // Llenar formulario
    await page.getByLabel(/email/i).fill(`${slug}@test.local`);
    await page.getByLabel(/código/i).fill("123456");
    await page.getByLabel(/^nueva contraseña/i).fill("NuevaPass123!");
    await page.getByLabel(/confirmar/i).fill("NuevaPass123!");

    await page.getByRole("button", { name: /restablecer contraseña/i }).click();

    // Éxito: banner "Contraseña actualizada"
    await expect(page.getByText("Contraseña actualizada")).toBeVisible({
      timeout: 8_000,
    });

    // Mensaje de redirección
    await expect(page.getByText(/redirigiendo al login/i)).toBeVisible({
      timeout: 3_000,
    });

    // Después de ~2 segundos, redirige a /admin/login
    await expect(page).toHaveURL(/admin\/login/, { timeout: 5_000 });
  });

  // ── J.5 · Validación client-side: contraseñas no coinciden ───────────────

  test("J.5 · reset-password con contraseñas distintas desactiva el botón", async ({
    page,
  }) => {
    await page.goto(`/${slug}/admin/reset-password`);
    await page.waitForLoadState("networkidle");

    await page.getByLabel(/email/i).fill(`${slug}@test.local`);
    await page.getByLabel(/código/i).fill("123456");
    await page.getByLabel(/^nueva contraseña/i).fill("Password123!");
    // Contraseña de confirmación diferente
    await page.getByLabel(/confirmar/i).fill("OtraPassword456!");

    // Error de validación visible
    await expect(page.getByText(/contraseñas no coinciden/i)).toBeVisible({
      timeout: 3_000,
    });

    // Botón deshabilitado
    await expect(
      page.getByRole("button", { name: /restablecer contraseña/i }),
    ).toBeDisabled();
  });
});
