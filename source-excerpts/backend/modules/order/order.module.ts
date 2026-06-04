import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { OrderController } from "./order.controller";
import { OrderService } from "./order.service";
import { Order, OrderSchema } from "./schemas/order.schema";
import {
  PickupCounter,
  PickupCounterSchema,
} from "./schemas/pickup-counter.schema";
import {
  DailyOrderCounter,
  DailyOrderCounterSchema,
} from "./schemas/daily-order-counter.schema";
import { Staff, StaffSchema } from "../booking/schemas/staff.schema";
import { TenantModule } from "../tenant/tenant.module";
import { MenuModule } from "../menu/menu.module";
import { GatewayModule } from "../gateway/gateway.module";
import { PaymentModule } from "../payment/payment.module";
import { BcvRateModule } from "../bcv-rate/bcv-rate.module";
import { MediaModule } from "../media/media.module";
import { PushModule } from "../push/push.module";
import { EmailService } from "../auth/email.service";
import { NotificationModule } from "../notification/notification.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: PickupCounter.name, schema: PickupCounterSchema },
      { name: DailyOrderCounter.name, schema: DailyOrderCounterSchema },
      { name: Staff.name, schema: StaffSchema }, // R5: staff-service cross-validation
    ]),
    TenantModule, // para resolver el tenant por slug
    MenuModule, // para resolver precios reales y calcular total server-side
    GatewayModule, // para emitir eventos en tiempo real a cocina/admin/mesa
    PaymentModule, // para registrar payment_transactions (audit + cerrar caja)
    BcvRateModule, // para snapshot de pricing al crear la orden (USD → Bs)
    MediaModule, // para subir comprobantes PagoMóvil a Cloudinary (P1.13)
    PushModule, // para notificaciones push al cliente (P1.15)
    NotificationModule, // para notificaciones WhatsApp al cliente (P2.2)
  ],
  controllers: [OrderController],
  providers: [OrderService, EmailService],
  exports: [OrderService, MongooseModule],
})
export class OrderModule {}
