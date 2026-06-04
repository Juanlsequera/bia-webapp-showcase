import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { TenantService } from "./tenant.service";
import { TenantConfigService } from "./tenant-config.service";
import { TenantController } from "./tenant.controller";
import { Tenant, TenantSchema } from "./schemas/tenant.schema";
import {
  TenantConfig,
  TenantConfigSchema,
} from "./schemas/tenant-config.schema";
import { User, UserSchema } from "../auth/schemas/user.schema";
import { AuthModule } from "../auth/auth.module";
import { BcvRateModule } from "../bcv-rate/bcv-rate.module";
import { MediaModule } from "../media/media.module";
import { ModuleEnabledGuard } from "./guards/module-enabled.guard";
import { PlanProGuard } from "../../common/guards/plan-pro.guard";

/**
 * TenantModule expone:
 *   - GET    /tenants/:slug/public     (público)
 *   - GET    /tenants/me               (JWT admin)
 *   - PATCH  /tenants/me               (JWT admin)
 *   - GET    /tenants                  (JWT superadmin)
 *   - POST   /tenants                  (JWT superadmin)
 *   - PATCH  /tenants/:tenantId/active (JWT superadmin)
 *
 * Exporta TenantService y el modelo de Tenant para que OrderModule
 * y MenuModule puedan resolver tenantId por slug.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: TenantConfig.name, schema: TenantConfigSchema },
      // Necesitamos el UserModel para chequear conflicto de email al alta
      { name: User.name, schema: UserSchema },
    ]),
    AuthModule, // AuthService.createUser() para el admin inicial
    BcvRateModule, // BcvRateService.getCurrent() para enriquecer el payload público
    MediaModule, // MediaService para upload de logo del tenant
    // OnboardingModule NO se importa acá para evitar el ciclo:
    // TenantModule → OnboardingModule → MenuModule → TenantModule.
    // El endpoint canónico de configure vive en onboarding.controller.ts.
  ],
  controllers: [TenantController],
  providers: [
    TenantService,
    TenantConfigService,
    ModuleEnabledGuard,
    PlanProGuard,
  ],
  exports: [
    TenantService,
    TenantConfigService,
    ModuleEnabledGuard,
    PlanProGuard,
    MongooseModule,
  ],
})
export class TenantModule {}
