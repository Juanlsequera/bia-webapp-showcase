import { test, expect } from "@playwright/test";
import {
  bootstrapSuperadmin,
  createTenantViaApi,
  resetDbViaApi,
  loginAsTenantAdmin,
} from "./helpers/api.helper";

const API = process.env.PW_API_URL ?? "http://localhost:3001";

const BANK_DTO = {
  bank: "Banesco",
  phone: "04141234567",
  rif: "V-12345678",
  accountHolder: "Starter Test C.A.",
  isDefault: true,
};

test.describe("Plan limits — Starter", () => {
  let saToken: string;
  let tenantId: string;
  let adminToken: string;

  test.beforeEach(async ({ request }) => {
    await resetDbViaApi(request);
    await request.post(`${API}/auth/bootstrap`);
    saToken = await bootstrapSuperadmin(request);
    tenantId = await createTenantViaApi(request, saToken, "plan-limits-test");
    adminToken = await loginAsTenantAdmin(request, "plan-limits-test");
  });

  test("admin starter puede agregar su única cuenta PagoMóvil", async ({
    request,
  }) => {
    const res = await request.post(`${API}/tenants/me/bank-accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: BANK_DTO,
    });
    expect(res.status()).toBe(201);
  });

  test("API retorna 400 al intentar crear segunda cuenta PagoMóvil en Starter", async ({
    request,
  }) => {
    // Primera cuenta — debe pasar
    const first = await request.post(`${API}/tenants/me/bank-accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: BANK_DTO,
    });
    expect(first.status()).toBe(201);

    // Segunda cuenta — debe ser 400
    const second = await request.post(`${API}/tenants/me/bank-accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { ...BANK_DTO, bank: "Mercantil", isDefault: false },
    });
    expect(second.status()).toBe(400);
    const body = await second.json();
    // HttpExceptionFilter wraps: body.message = { statusCode, message, error }
    const errText =
      typeof body.message === "string"
        ? body.message
        : (body.message?.message ?? "");
    expect(errText).toMatch(/starter|plan/i);
  });

  test("cuenta PagoMóvil inactiva bloquea creación de segunda cuenta", async ({
    request,
  }) => {
    // Crear primera cuenta
    const createRes = await request.post(`${API}/tenants/me/bank-accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: BANK_DTO,
    });
    expect(createRes.status()).toBe(201);
    const accounts: Array<{ _id: string }> = await createRes.json();
    const firstId = accounts[0]._id;

    // Desactivar la cuenta
    await request.patch(`${API}/tenants/me/bank-accounts/${firstId}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { isActive: false },
    });

    // Intentar crear otra — debe ser 400 (inactiva cuenta para el límite)
    const second = await request.post(`${API}/tenants/me/bank-accounts`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { ...BANK_DTO, bank: "Mercantil", isDefault: false },
    });
    expect(second.status()).toBe(400);
  });

  test("admin pro puede agregar múltiples cuentas PagoMóvil", async ({
    request,
  }) => {
    // Upgrade a pro via superadmin
    await request.patch(`${API}/tenants/${tenantId}/plan`, {
      headers: { Authorization: `Bearer ${saToken}` },
      data: { plan: "pro" },
    });

    // Agregar 3 cuentas seguidas — todas deben ser 201
    for (const bank of ["Banesco", "Mercantil", "BDV"]) {
      const res = await request.post(`${API}/tenants/me/bank-accounts`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { ...BANK_DTO, bank, isDefault: bank === "Banesco" },
      });
      expect(res.status()).toBe(201);
    }
  });
});
