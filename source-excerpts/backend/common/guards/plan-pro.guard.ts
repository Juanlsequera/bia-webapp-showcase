import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import {
  Tenant,
  TenantDocument,
} from "../../modules/tenant/schemas/tenant.schema";

/**
 * Guard para endpoints exclusivos del Plan Pro o superior.
 * Uso: @UseGuards(JwtAuthGuard, PlanProGuard)
 *
 * Superadmin (sin tenantId) siempre pasa.
 * Tenants con plan 'pro' o 'enterprise' pasan.
 * Tenants con plan 'starter' reciben 403 con mensaje de upgrade.
 * Tenant sin campo 'plan' (legacy) se trata como 'starter'.
 */
@Injectable()
export class PlanProGuard implements CanActivate {
  constructor(
    @InjectModel(Tenant.name)
    private readonly tenantModel: Model<TenantDocument>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<{ user?: { tenantId?: string } }>();
    const tenantId = req.user?.tenantId;

    // Superadmin o ruta pública → siempre pasa
    if (!tenantId) return true;

    const tenant = await this.tenantModel
      .findById(tenantId)
      .select("plan")
      .lean()
      .exec();

    if (!tenant) throw new ForbiddenException("Negocio no encontrado");

    const plan = (tenant as any).plan ?? "starter";
    if (plan === "starter") {
      throw new ForbiddenException(
        "Esta funcionalidad requiere el Plan Pro. Contactá a soporte para actualizar tu plan.",
      );
    }

    return true;
  }
}
