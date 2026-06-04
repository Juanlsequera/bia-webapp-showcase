import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OrdersGateway } from "./orders.gateway";

// GatewayModule aísla la infra de WebSockets y expone OrdersGateway al
// resto de la app. Importa AuthModule porque reutilizamos su JwtService
// (re-exportado desde AuthModule) para verificar tokens en el handshake.
//
// Otros módulos (OrderModule, PaymentModule futuro) importan GatewayModule
// para inyectar OrdersGateway y emitir eventos.
@Module({
  imports: [AuthModule],
  providers: [OrdersGateway],
  exports: [OrdersGateway],
})
export class GatewayModule {}
