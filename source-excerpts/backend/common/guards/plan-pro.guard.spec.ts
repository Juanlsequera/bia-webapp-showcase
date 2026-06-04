import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Test, TestingModule } from "@nestjs/testing";
import { Types } from "mongoose";
import { PlanProGuard } from "./plan-pro.guard";
import { Tenant } from "../../modules/tenant/schemas/tenant.schema";

const TENANT_ID = new Types.ObjectId().toHexString();

function buildContext(tenantId: string | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user: tenantId ? { tenantId } : {} }),
    }),
  } as unknown as ExecutionContext;
}

async function buildGuard(tenantDoc: Record<string, unknown> | null) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      PlanProGuard,
      {
        provide: getModelToken(Tenant.name),
        useValue: {
          findById: jest.fn().mockReturnValue({
            select: jest.fn().mockReturnValue({
              lean: jest.fn().mockReturnValue({
                exec: jest.fn().mockResolvedValue(tenantDoc),
              }),
            }),
          }),
        },
      },
    ],
  }).compile();

  return module.get<PlanProGuard>(PlanProGuard);
}

describe("PlanProGuard", () => {
  it("permite acceso a tenant con plan pro", async () => {
    const guard = await buildGuard({ _id: TENANT_ID, plan: "pro" });
    const result = await guard.canActivate(buildContext(TENANT_ID));
    expect(result).toBe(true);
  });

  it("permite acceso a tenant con plan enterprise", async () => {
    const guard = await buildGuard({ _id: TENANT_ID, plan: "enterprise" });
    const result = await guard.canActivate(buildContext(TENANT_ID));
    expect(result).toBe(true);
  });

  it("bloquea acceso a tenant con plan starter con ForbiddenException", async () => {
    const guard = await buildGuard({ _id: TENANT_ID, plan: "starter" });
    await expect(guard.canActivate(buildContext(TENANT_ID))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("permite acceso cuando no hay tenantId (superadmin)", async () => {
    const guard = await buildGuard(null);
    const result = await guard.canActivate(buildContext(undefined));
    expect(result).toBe(true);
  });

  it("lanza ForbiddenException si el tenant no existe en BD", async () => {
    const guard = await buildGuard(null);
    await expect(guard.canActivate(buildContext(TENANT_ID))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("tenant sin campo plan se trata como starter y es bloqueado", async () => {
    const guard = await buildGuard({ _id: TENANT_ID /* plan ausente */ });
    await expect(guard.canActivate(buildContext(TENANT_ID))).rejects.toThrow(
      ForbiddenException,
    );
  });
});
