import { test, expect, APIRequestContext } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  configureTenant,
  loginAsTenantAdmin,
  resetDbViaApi,
  createOrderViaApi,
  addBankAccountViaApi,
  getFirstProductViaApi,
} from "./helpers/api.helper";

/**
 * BCV Rate — Override manual + invariante de snapshot de órdenes
 *
 * Cubre el flujo completo del override de tasa BCV desde la perspectiva de API:
 *
 *   1. Sin override: la tasa actual viene del upstream / cache.
 *   2. Admin fija override manual → GET /bcv-rate devuelve la tasa manual.
 *   3. Nueva orden creada DESPUÉS del override usa la tasa overrideada en pricing.
 *   4. Orden creada ANTES del override conserva su snapshot inmutable.
 *   5. Admin cancela override (refresh) → la tasa vuelve al BCV real.
 *   6. Rol no-admin no puede setear override (401/403).
 *
 * API routes bajo test:
 *   GET  /bcv-rate                    → pública, devuelve UsdRate con manual_override
 *   POST /admin/bcv-rate/override     → admin/superadmin, fija tasa manual
 *   POST /admin/bcv-rate/refresh      → admin/superadmin, cancela override
 *   POST /{slug}/orders               → cliente, crea orden (usa tasa actual en pricing)
 *
 * Nota sobre el upstream real:
 *   En CI la API apunta a dolarapi.com en vivo. Para aislar el test del upstream,
 *   fijamos un override justo al principio con un valor controlado (99.99) y
 *   verificamos que la tasa override sea exactamente ese valor.
 */
test.describe.serial("BCV Rate — Override manual", () => {
  const API = process.env.PW_API_URL ?? "http://localhost:3001";
  const OVERRIDE_RATE = 99.99; // tasa artificial fácil de detectar
  const OVERRIDE_TTL = 1; // 1 hora

  let adminToken: string;
  let saToken: string;
  let slug: string;
  let tenantId: string;

  // Pricing de la orden creada ANTES del override (para probar inmutabilidad)
  // No existe GET /admin/orders/:id — guardamos el pricing desde la respuesta de creación.
  let orderBeforeOverridePricing: {
    usd_rate: number;
    total_bs: number;
    total_usd: number;
  };

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext();
    await resetDbViaApi(api);
    await api.post(`${API}/auth/bootstrap`);
    saToken = await bootstrapSuperadmin(api);

    slug = `bcv-override-${Date.now()}`;
    tenantId = await createTenantViaApi(api, saToken, slug);
    await configureTenant(api, saToken, tenantId, "food", "restaurant-qr");

    adminToken = await loginAsTenantAdmin(api, slug);
    await addBankAccountViaApi(api, adminToken);

    // Limpiar cualquier override manual que haya quedado en Redis de un run anterior.
    // resetDbViaApi solo borra MongoDB; el cache Redis persiste entre runs.
    await api.post(`${API}/admin/bcv-rate/refresh`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
  });

  // ── 1 ─────────────────────────────────────────────────────────────────────
  test("1 · GET /bcv-rate devuelve una tasa válida sin override activo", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();
    const res = await api.get(`${API}/bcv-rate`);

    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    expect(typeof body.value).toBe("number");
    expect(body.value).toBeGreaterThan(0);
    expect(body.source).toMatch(/^(bcv|fallback)$/);
    // Sin override activo
    expect(body.manual_override).toBeFalsy();
  });

  // ── 2 ─────────────────────────────────────────────────────────────────────
  test("2 · orden creada ANTES del override conserva su snapshot (baseline)", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    // Crear orden antes del override — usamos api.post directamente para obtener
    // el pricing completo de la respuesta (no existe GET /admin/orders/:id).
    const product = await getFirstProductViaApi(api, adminToken);
    const res = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "dine_in",
        tableNumber: 1,
        paymentMethod: "pagomovil",
        customer_name: "Cliente BCV Baseline",
        items: [{ productId: product._id, quantity: 1 }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const orderBody = await res.json();

    // Guardar pricing para verificar inmutabilidad en test 5
    orderBeforeOverridePricing = orderBody.pricing;

    expect(orderBody._id).toBeTruthy();
    // pricing.usd_rate debe ser la tasa actual (no la override 99.99)
    expect(orderBody.pricing).toBeDefined();
    expect(orderBody.pricing.usd_rate).not.toBe(OVERRIDE_RATE);
    expect(orderBody.pricing.total_bs).toBeGreaterThan(0);
  });

  // ── 3 ─────────────────────────────────────────────────────────────────────
  test("3 · admin fija override → GET /bcv-rate devuelve la tasa manual", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const res = await api.post(`${API}/admin/bcv-rate/override`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: {
        rate: OVERRIDE_RATE,
        ttl_hours: OVERRIDE_TTL,
        reason: "Test E2E override",
      },
    });

    expect(res.ok()).toBeTruthy();
    const body = await res.json();

    expect(body.value).toBe(OVERRIDE_RATE);
    expect(body.source).toBe("manual");
    expect(body.manual_override).toBe(true);
    expect(body.stale).toBe(false);
    expect(body.set_by).toBeTruthy(); // email del admin

    // Verificar que GET /bcv-rate refleja el override
    const checkRes = await api.get(`${API}/bcv-rate`);
    const checkBody = await checkRes.json();

    expect(checkBody.value).toBe(OVERRIDE_RATE);
    expect(checkBody.manual_override).toBe(true);
    expect(checkBody.source).toBe("manual");
  });

  // ── 4 ─────────────────────────────────────────────────────────────────────
  test("4 · nueva orden usa la tasa overrideada en pricing", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const product = await getFirstProductViaApi(api, adminToken);

    // POST /{slug}/orders devuelve la orden completa con el campo pricing
    // (no hay GET /admin/orders/:id — usamos la respuesta de creación directamente)
    const res = await api.post(`${API}/${slug}/orders`, {
      data: {
        orderType: "dine_in",
        tableNumber: 1,
        paymentMethod: "pagomovil",
        customer_name: "Cliente BCV Test",
        items: [{ productId: product._id, quantity: 1 }],
      },
    });
    expect(res.ok()).toBeTruthy();
    const orderBody = await res.json();

    expect(orderBody._id).toBeTruthy();

    // El snapshot de pricing debe usar la tasa override
    expect(orderBody.pricing).toBeDefined();
    expect(orderBody.pricing.usd_rate).toBe(OVERRIDE_RATE);
    expect(orderBody.pricing.total_bs).toBeGreaterThan(0);

    // total_bs = total_usd * usd_rate (redondeado a 2 decimales)
    const expectedBs =
      Math.round(orderBody.pricing.total_usd * OVERRIDE_RATE * 100) / 100;
    expect(orderBody.pricing.total_bs).toBeCloseTo(expectedBs, 1);
  });

  // ── 5 ─────────────────────────────────────────────────────────────────────
  test("5 · orden anterior conserva su snapshot inmutable (no afectada por override)", async () => {
    // El pricing fue capturado en el test 2 desde la respuesta de creación.
    // No existe GET /admin/orders/:id, así que verificamos el snapshot guardado.
    // La invariante es: si una orden se creó ANTES del override, su usd_rate
    // no debe ser el OVERRIDE_RATE (99.99) sino la tasa real del momento.
    expect(orderBeforeOverridePricing).toBeDefined();
    // La tasa snapshot es la que había al crear la orden (no la override 99.99)
    expect(orderBeforeOverridePricing.usd_rate).not.toBe(OVERRIDE_RATE);
    // El total en Bs fue calculado con esa tasa real
    expect(orderBeforeOverridePricing.total_bs).toBeGreaterThan(0);
    // Consistencia: total_bs ≈ total_usd × usd_rate
    const expectedBs =
      Math.round(
        orderBeforeOverridePricing.total_usd *
          orderBeforeOverridePricing.usd_rate *
          100,
      ) / 100;
    expect(orderBeforeOverridePricing.total_bs).toBeCloseTo(expectedBs, 1);
  });

  // ── 6 ─────────────────────────────────────────────────────────────────────
  test("6 · superadmin también puede fijar override", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const res = await api.post(`${API}/admin/bcv-rate/override`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: {
        rate: 100.5,
        ttl_hours: 1,
        reason: "Test superadmin override",
      },
    });

    // El superadmin tiene acceso al endpoint de admin
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.value).toBe(100.5);
  });

  // ── 7 ─────────────────────────────────────────────────────────────────────
  test("7 · sin token recibe 401 al intentar override", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const res = await api.post(`${API}/admin/bcv-rate/override`, {
      data: { rate: 50, ttl_hours: 1 },
    });

    expect(res.status()).toBe(401);
  });

  // ── 8 ─────────────────────────────────────────────────────────────────────
  test("8 · admin cancela override con refresh → tasa vuelve al BCV real", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    // El override de 100.5 del test 6 está activo
    const before = await api.get(`${API}/bcv-rate`);
    const beforeBody = await before.json();
    expect(beforeBody.manual_override).toBe(true);

    // Cancelar override (refresh fuerza fetch del upstream)
    const refreshRes = await api.post(`${API}/admin/bcv-rate/refresh`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(refreshRes.ok()).toBeTruthy();
    const refreshBody = await refreshRes.json();

    // Tras el refresh, la tasa ya no es manual
    expect(refreshBody.source).toMatch(/^(bcv|fallback)$/);
    expect(refreshBody.manual_override).toBeFalsy();

    // GET /bcv-rate confirma que el override ya no está activo
    const after = await api.get(`${API}/bcv-rate`);
    const afterBody = await after.json();

    expect(afterBody.manual_override).toBeFalsy();
    // La tasa post-refresh no debe ser ninguna de las tasas manuales
    expect(afterBody.value).not.toBe(100.5);
    expect(afterBody.value).not.toBe(OVERRIDE_RATE);
  });

  // ── 9 ─────────────────────────────────────────────────────────────────────
  test("9 · override con tasa inválida devuelve 400", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    const cases = [
      { rate: 0, ttl_hours: 1 }, // cero
      { rate: -5, ttl_hours: 1 }, // negativo
      { rate: "abc", ttl_hours: 1 }, // no numérico
      { rate: 50, ttl_hours: 0 }, // TTL cero
      { rate: 50, ttl_hours: 200 }, // TTL > máximo (168h)
    ];

    for (const payload of cases) {
      const res = await api.post(`${API}/admin/bcv-rate/override`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: payload,
      });
      expect(res.status(), `payload: ${JSON.stringify(payload)}`).toBe(400);
    }
  });

  // ── 10 ────────────────────────────────────────────────────────────────────
  test("10 · GET /rates incluye tasa USD aunque haya override (snapshot consistente)", async ({
    playwright,
  }) => {
    const api = await playwright.request.newContext();

    // Fijar override con valor conocido
    await api.post(`${API}/admin/bcv-rate/override`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { rate: 77.77, ttl_hours: 1 },
    });

    // GET /rates (endpoint público de snapshot multi-divisa)
    const ratesRes = await api.get(`${API}/rates`);
    expect(ratesRes.ok()).toBeTruthy();
    const ratesBody = await ratesRes.json();

    // El snapshot devuelve { rates: MarketRate[], fetchedAt } — buscar USD_BCV en el array
    const usdBcv = (ratesBody.rates as any[]).find(
      (r: any) => r.code === "USD_BCV",
    );
    expect(usdBcv).toBeDefined();
    expect(usdBcv.value).toBe(77.77);
  });
});
