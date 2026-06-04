import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { Tenant, TenantDocument } from "../schemas/tenant.schema";
import { REQUIRE_MODULE_KEY } from "../decorators/require-module.decorator";

/**
 * Guard que verifica si un módulo específico está habilitado para el tenant.
 *
 * Lee directamente tenant.modules (persistido durante el onboarding) en vez de
 * pasar por getEffective. Más simple y confiable para módulos como quotes_estimates
 * o kitchen_kds que se setean explícitamente al configurar el arquetipo.
 *
 * Requiere:
 *  - @RequireModule('nombre_modulo') en el handler o controller.
 *  - JwtAuthGuard ya corrido (necesita req.user.tenantId).
 *
 * Si el módulo no existe en tenant.modules → habilitado por default (backward-compat).
 */
@Injectable()
export class ModuleEnabledGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @InjectModel(Tenant.name)
    private readonly tenantModel: Model<TenantDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<
      string | string[] | undefined
    >(REQUIRE_MODULE_KEY, [context.getHandler(), context.getClass()]);

    if (!required) return true;

    const req = context
      .switchToHttp()
      .getRequest<{ user?: { tenantId?: string } }>();
    const tenantId = req.user?.tenantId;

    // Superadmin o ruta pública (sin tenantId) → pasar siempre.
    if (!tenantId) return true;

    const tenant = await this.tenantModel
      .findById(tenantId)
      .select("modules")
      .lean()
      .exec();

    if (!tenant)
      throw new ForbiddenException("Negocio no encontrado o inactivo");

    const modules = (tenant.modules ?? {}) as Record<string, boolean>;

    // Normalizar a array para soportar lógica OR con múltiples módulos.
    const requiredModules = Array.isArray(required) ? required : [required];

    // Lógica OR: basta con que UNO de los módulos esté habilitado.
    // Módulo ausente → habilitado por default (tenants legacy sin configuración).
    const hasAccess = requiredModules.some(
      (mod) => modules[mod] === undefined || modules[mod] === true,
    );

    if (!hasAccess) {
      const modulesList = requiredModules.join('" o "');
      throw new ForbiddenException(
        `Ninguno de los módulos "${modulesList}" está habilitado para este negocio`,
      );
    }

    return true;
  }
}
