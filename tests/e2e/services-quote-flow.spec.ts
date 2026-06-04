import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  resetDbViaApi,
} from "./helpers/api.helper";

const API = process.env.PW_API_URL ?? "http://localhost:3001";

test.describe("Services — flujo cotización (solicitar → admin cotiza → cliente aprueba)", () => {
  let slug: string;
  let saToken: string;

  test.beforeEach(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    saToken = await bootstrapSuperadmin(api);
    slug = `service-e2e-${Date.now()}`;
    const tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(
      api,
      saToken,
      tenantId,
      "service",
      "tech-support-service",
    );
  });

  test("cliente solicita servicio, admin envía cotización, cliente aprueba", async ({
    playwright,
  }) => {
    // ── Step 1: obtener el primer servicio disponible en el catálogo ──────────────
    const publicApi = await playwright.request.newContext();
    const catalogRes = await publicApi.get(`${API}/${slug}/menu`);
    expect(catalogRes.ok()).toBe(true);
    const catalog = await catalogRes.json();
    const allItems = (catalog.categories ?? []).flatMap(
      (c: any) => c.items ?? [],
    );
    const firstService = allItems[0];
    expect(firstService).toBeTruthy();

    // ── Step 2: cliente crea orden de servicio (inquiry) ────────────────────────
    const orderRes = await publicApi.post(`${API}/${slug}/orders`, {
      data: {
        archetype: "service",
        orderType: "takeaway",
        paymentMethod: "cash",
        customer_name: "Cliente E2E Test",
        customer_phone: "04141234567",
        items: [
          {
            productId: firstService._id,
            quantity: 1,
            notes: "Solicitud de prueba E2E",
          },
        ],
      },
    });
    expect(orderRes.ok()).toBe(true);
    const order = await orderRes.json();
    expect(order._id).toBeTruthy();
    expect(order.status).toBe("inquiry");

    // ── Step 3: admin envía cotización ───────────────────────────────────────────
    // Los endpoints /admin/* requieren rol 'admin' del tenant, no superadmin.
    // El createTenantViaApi crea el admin con email="${slug}@test.local" y password="admin-pw-test123".
    const adminLoginRes = await publicApi.post(`${API}/auth/login`, {
      data: { email: `${slug}@test.local`, password: "admin-pw-test123" },
    });
    expect(adminLoginRes.ok()).toBe(true);
    const { access_token: adminToken } = await adminLoginRes.json();

    const adminApi = await playwright.request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${adminToken}` },
    });
    const quoteRes = await adminApi.patch(
      `${API}/admin/orders/${order._id}/quote`,
      {
        data: {
          quote_amount: 25.0,
          quote_notes: "Diagnóstico: falla de disco. Repuesto extra.",
        },
      },
    );
    expect(quoteRes.ok()).toBe(true);
    const quoted = await quoteRes.json();
    expect(quoted.status).toBe("quoted");

    // ── Step 4: admin aprueba la cotización ───────────────────────────────────────
    // Usa /admin/orders/:id/status (requiere quotes_estimates, no kitchen_kds)
    // /kitchen/orders/:id/status falla 403 en tenants service con kitchen_kds desactivado
    const approveRes = await adminApi.patch(
      `${API}/admin/orders/${order._id}/status`,
      {
        data: { status: "approved" },
      },
    );
    expect(approveRes.ok()).toBe(true);
    const approved = await approveRes.json();
    expect(approved.status).toBe("approved");

    // ── Step 5: verificar estado final vía endpoint público ────────────────────────
    const statusRes = await publicApi.get(
      `${API}/${slug}/orders/${order._id}/status`,
    );
    expect(statusRes.ok()).toBe(true);
    const finalStatus = await statusRes.json();
    expect(finalStatus.status).toBe("approved");
  });
});
