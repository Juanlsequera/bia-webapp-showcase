import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ModuleEnabledGuard } from "./module-enabled.guard";
import { REQUIRE_MODULE_KEY } from "../decorators/require-module.decorator";

/**
 * Tests unitarios del ModuleEnabledGuard.
 * Cubre todos los casos del contrato del guard:
 *  - Sin decorator → pasa siempre
 *  - Sin tenantId (superadmin/público) → pasa siempre
 *  - modules[key] === true → pasa
 *  - modules[key] === false → 403
 *  - modules[key] === undefined → pasa (backward compat, tenants legacy)
 *  - Tenant no encontrado → pasa (defensive)
 */
describe("ModuleEnabledGuard", () => {
  let guard: ModuleEnabledGuard;
  let reflector: jest.Mocked<Reflector>;
  let mockTenantModel: any;

  const tenantId = "507f1f77bcf86cd799439011";

  function makeContext(opts: {
    requiredModule?: string;
    tenantId?: string;
    modules?: Record<string, boolean | undefined>;
  }): ExecutionContext {
    reflector.getAllAndOverride.mockReturnValue(
      opts.requiredModule ?? undefined,
    );

    const tenantDoc =
      opts.modules !== undefined ? { modules: opts.modules } : null;

    mockTenantModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue(tenantDoc),
        }),
      }),
    });

    return {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: opts.tenantId ? { tenantId: opts.tenantId } : undefined,
        }),
      }),
    } as unknown as ExecutionContext;
  }

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn(),
    } as any;

    mockTenantModel = {
      findById: jest.fn(),
    };

    guard = new ModuleEnabledGuard(reflector, mockTenantModel);
  });

  it("pasa cuando no hay @RequireModule en el handler", async () => {
    const ctx = makeContext({ requiredModule: undefined, tenantId });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockTenantModel.findById).not.toHaveBeenCalled();
  });

  it("pasa cuando no hay tenantId (superadmin o ruta pública)", async () => {
    const ctx = makeContext({
      requiredModule: "advanced_analytics",
      tenantId: undefined,
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(mockTenantModel.findById).not.toHaveBeenCalled();
  });

  it("pasa cuando modules.advanced_analytics === true", async () => {
    const ctx = makeContext({
      requiredModule: "advanced_analytics",
      tenantId,
      modules: { advanced_analytics: true },
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("lanza 403 cuando modules.advanced_analytics === false", async () => {
    const ctx = makeContext({
      requiredModule: "advanced_analytics",
      tenantId,
      modules: { advanced_analytics: false },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("pasa cuando modules.advanced_analytics === undefined (backward compat)", async () => {
    const ctx = makeContext({
      requiredModule: "advanced_analytics",
      tenantId,
      modules: {},
    });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("lanza 403 cuando el tenant no existe en DB (fail-closed)", async () => {
    const ctx = makeContext({
      requiredModule: "advanced_analytics",
      tenantId,
      modules: undefined, // tenantDoc = null
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(
      "Negocio no encontrado o inactivo",
    );
  });

  it("lanza 403 para quotation_builder false (plan starter)", async () => {
    const ctx = makeContext({
      requiredModule: "quotation_builder",
      tenantId,
      modules: { quotation_builder: false },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("lanza 403 para finance_documents false", async () => {
    const ctx = makeContext({
      requiredModule: "finance_documents",
      tenantId,
      modules: { finance_documents: false },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("lanza 403 para payment_links false", async () => {
    const ctx = makeContext({
      requiredModule: "payment_links",
      tenantId,
      modules: { payment_links: false },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("el mensaje de error incluye el nombre del módulo", async () => {
    const ctx = makeContext({
      requiredModule: "advanced_analytics",
      tenantId,
      modules: { advanced_analytics: false },
    });
    await expect(guard.canActivate(ctx)).rejects.toThrow("advanced_analytics");
  });

  // ── Array OR logic ─────────────────────────────────────────────────────────

  it("pasa cuando el primer módulo del array está habilitado (OR)", async () => {
    reflector.getAllAndOverride.mockReturnValue([
      "booking",
      "quotes_estimates",
    ]);
    mockTenantModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            modules: { booking: true, quotes_estimates: false },
          }),
        }),
      }),
    });
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { tenantId } }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("pasa cuando el segundo módulo del array está habilitado (OR)", async () => {
    reflector.getAllAndOverride.mockReturnValue([
      "booking",
      "quotes_estimates",
    ]);
    mockTenantModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            modules: { booking: false, quotes_estimates: true },
          }),
        }),
      }),
    });
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { tenantId } }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it("lanza 403 cuando TODOS los módulos del array están deshabilitados", async () => {
    reflector.getAllAndOverride.mockReturnValue([
      "booking",
      "quotes_estimates",
    ]);
    mockTenantModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({
            modules: { booking: false, quotes_estimates: false },
          }),
        }),
      }),
    });
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { tenantId } }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).rejects.toThrow(ForbiddenException);
  });

  it("pasa cuando un módulo del array es undefined/ausente (backward compat OR)", async () => {
    reflector.getAllAndOverride.mockReturnValue([
      "booking",
      "quotes_estimates",
    ]);
    mockTenantModel.findById.mockReturnValue({
      select: jest.fn().mockReturnValue({
        lean: jest.fn().mockReturnValue({
          exec: jest.fn().mockResolvedValue({ modules: { booking: false } }), // quotes_estimates ausente → undefined → pasa
        }),
      }),
    });
    const ctx = {
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({ getRequest: () => ({ user: { tenantId } }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });
});
