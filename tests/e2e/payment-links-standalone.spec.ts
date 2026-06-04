import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  loginAsTenantAdmin,
  addBankAccountViaApi,
  enableModulesViaApi,
  resetDbViaApi,
} from "./helpers/api.helper";

/**
 * Payment Links Standalone — Test O
 *
 * Los payment links son cobros directos que el admin crea y comparte por
 * WhatsApp/SMS. El cliente abre la URL pública y paga sin crear una orden.
 * Son independientes del flujo QR-mesa y del carrito.
 *
 *   O.1 · Ciclo completo PagoMóvil:
 *         Admin crea link ($15) → enlace activo → cliente envía PagoMóvil →
 *         link en "pending_verification" → admin marca como cobrado →
 *         link en "paid".
 *
 *   O.2 · Cancelar link:
 *         Admin crea link → PATCH cancel → link en "cancelled".
 *         Después de cancelar, el cliente no puede pagar.
 *
 *   O.3 · Listar links del tenant:
 *         GET /admin/payment-links → array con los links creados.
 *
 *   O.4 · UI pública del link:
 *         El cliente navega a /:slug/pago/:linkId → ve el monto + método de
 *         pago + formulario de comprobante (mock Cloudinary + mock LLM).
 *
 * Todos los tests son pure-API excepto O.4 que usa browser.
 */
test.describe("Payment Links Standalone", () => {
  const API = process.env.PW_API_URL ?? "http://localhost:3001";

  let slug: string;
  let adminToken: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    const saToken = await bootstrapSuperadmin(api);

    slug = `pl-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "food", "restaurant-qr");
    await enableModulesViaApi(api, saToken, tenantId, { payment_links: true });
    adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);
  });

  // ── Helper: crea un payment link ─────────────────────────────────────────

  async function createLink(
    api: any,
    amount = 15,
    description = "Cobro E2E Test",
  ): Promise<string> {
    const res = await api.post(`${API}/admin/payment-links`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        description,
        amount,
        paymentMethod: "pagomovil",
      },
    });
    if (!res.ok()) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        `createLink failed (${res.status()}): ${JSON.stringify(body)}`,
      );
    }
    const body = await res.json();
    return body._id as string;
  }

  // ── O.1 · Ciclo completo PagoMóvil ───────────────────────────────────────

  test("O.1 · ciclo completo: crear → PagoMóvil → mark-paid → paid", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const linkId = await createLink(api, 15, "Cobro servicio E2E");

    // El link debe estar activo
    const publicRes = await api.get(`${API}/${slug}/pago/${linkId}`);
    expect(publicRes.status()).toBe(200);
    const linkData = await publicRes.json();
    expect(linkData.status).toBe("active");
    expect(linkData.amount).toBe(15);

    // Cliente envía PagoMóvil (sin upload de imagen — pagomovil_receipt_url es una URL válida)
    const pagoRes = await api.patch(`${API}/${slug}/pago/${linkId}/pagomovil`, {
      data: {
        pagomovil_reference: "000111222333",
        pagomovil_phone: "04141234567",
        pagomovil_amount_bs: 600, // monto arbitrario en Bs
        pagomovil_receipt_url:
          "https://res.cloudinary.com/mock/receipt-e2e.jpg",
      },
    });
    expect(pagoRes.status()).toBe(200);
    const pagoBody = await pagoRes.json();
    expect(pagoBody.status).toBe("pending_verification");

    // Admin marca como cobrado
    const markPaidRes = await api.patch(
      `${API}/admin/payment-links/${linkId}/mark-paid`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { paidWith: "pagomovil" },
      },
    );
    expect(markPaidRes.status()).toBe(200);
    const paid = await markPaidRes.json();
    expect(paid.status).toBe("paid");

    // Verificar desde el endpoint público
    const finalPublic = await api.get(`${API}/${slug}/pago/${linkId}`);
    const finalData = await finalPublic.json();
    expect(finalData.status).toBe("paid");
  });

  // ── O.2 · Cancelar link ───────────────────────────────────────────────────

  test("O.2 · admin cancela link → cliente no puede pagar", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const linkId = await createLink(api, 20, "Link a cancelar");

    // Cancelar
    const cancelRes = await api.patch(
      `${API}/admin/payment-links/${linkId}/cancel`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
      },
    );
    expect(cancelRes.status()).toBe(200);
    const cancelled = await cancelRes.json();
    expect(cancelled.status).toBe("cancelled");

    // Cliente intenta pagar el link cancelado → error
    const pagoRes = await api.patch(`${API}/${slug}/pago/${linkId}/pagomovil`, {
      data: {
        pagomovil_reference: "999888777666",
        pagomovil_phone: "04141234567",
        pagomovil_amount_bs: 800,
        receipt_url: "https://res.cloudinary.com/mock/receipt2.jpg",
      },
    });
    expect(pagoRes.status()).toBeGreaterThanOrEqual(400);
  });

  // ── O.3 · Listar links del tenant ─────────────────────────────────────────

  test("O.3 · GET /admin/payment-links devuelve los links creados", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    // Crear 2 links
    const id1 = await createLink(api, 10, "Link uno");
    const id2 = await createLink(api, 25, "Link dos");

    const listRes = await api.get(`${API}/admin/payment-links`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(listRes.status()).toBe(200);
    const list = await listRes.json();
    const ids = (Array.isArray(list) ? list : (list.items ?? [])).map(
      (l: any) => l._id,
    );

    expect(ids).toContain(id1);
    expect(ids).toContain(id2);
  });

  // ── O.4 · UI pública del link (browser) ──────────────────────────────────

  test("O.4 · cliente abre /:slug/pago/:linkId y ve el formulario PagoMóvil", async ({
    page,
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const linkId = await createLink(api, 15, "Pago UI test");

    // Mockear Cloudinary y LLM extraction para no depender de credenciales reales
    await page.route("**/extract/pagomovil-receipt", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          data: {
            isValidReceipt: true,
            reference: "111222333444",
            amount: null,
            confidence: "high",
          },
          provider: "mock-e2e",
          latencyMs: 30,
        }),
      });
    });

    await page.route("**/upload-receipt", async (route) => {
      if (route.request().method() === "POST") {
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify({
            url: "https://res.cloudinary.com/mock/pl-receipt.jpg",
          }),
        });
      } else {
        await route.continue();
      }
    });

    // Navegar a la página pública del link
    await page.goto(`/${slug}/pago/${linkId}`);
    await page.waitForLoadState("networkidle");

    // El monto debe aparecer
    await expect(page.getByText("$15.00")).toBeVisible({ timeout: 10_000 });

    // PagoMóvil section
    await expect(page.getByText(/PagoMóvil/i).first()).toBeVisible({
      timeout: 5_000,
    });

    // Input de referencia PagoMóvil debe estar presente
    await expect(
      page.locator('input[placeholder*="123456"]').first(),
    ).toBeVisible({ timeout: 5_000 });

    // Input de teléfono debe estar presente
    await expect(page.locator('input[placeholder="04141234567"]')).toBeVisible({
      timeout: 3_000,
    });

    // El botón de confirmar pago debe estar presente (aunque deshabilitado hasta completar)
    await expect(
      page.getByRole("button", { name: /confirmar pago/i }),
    ).toBeVisible({ timeout: 3_000 });
  });
});
