import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { AnalyticsController } from "./analytics.controller";
import { AnalyticsService } from "./analytics.service";
import { Order, OrderSchema } from "../order/schemas/order.schema";
import { Tenant, TenantSchema } from "../tenant/schemas/tenant.schema";
import { AuthModule } from "../auth/auth.module";
import { ModuleEnabledGuard } from "../tenant/guards/module-enabled.guard";

/**
 * AnalyticsModule expone métricas de negocio al admin del tenant
 * y métricas globales al superadmin.
 *
 * Reutiliza el schema de Order directamente (sólo lectura). No depende
 * del OrderService para evitar dependencias circulares — todas las queries
 * son agregaciones independientes.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: Tenant.name, schema: TenantSchema },
    ]),
    AuthModule, // JwtAuthGuard + RolesGuard
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, ModuleEnabledGuard],
})
export class AnalyticsModule {}
