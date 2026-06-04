import { Module } from "@nestjs/common";
import { BcvRateController } from "./bcv-rate.controller";
import { BcvRateService } from "./bcv-rate.service";
import { RedisProvider } from "./redis.provider";
import { AuthModule } from "../auth/auth.module";

/**
 * BcvRateModule — tasa de cambio BCV (Bs por 1 USD).
 *
 * Expone:
 *   - GET  /bcv-rate                  público
 *   - POST /admin/bcv-rate/refresh    admin/superadmin
 *
 * Exporta `BcvRateService` para que TenantService lo inyecte y enriquezca
 * el payload público (`TenantPublic.usdRate`), y para que OrderService haga
 * el snapshot de pricing al crear órdenes.
 *
 * `AppLogger` se inyecta directo — `LoggerModule` es @Global.
 */
@Module({
  imports: [
    AuthModule, // JwtAuthGuard / RolesGuard
  ],
  controllers: [BcvRateController],
  providers: [BcvRateService, RedisProvider],
  exports: [BcvRateService],
})
export class BcvRateModule {}
