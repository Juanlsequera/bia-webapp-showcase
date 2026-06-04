import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Staff, StaffSchema } from "./schemas/staff.schema";
import { BookingService } from "./booking.service";
import { BookingController } from "./booking.controller";
import { TenantModule } from "../tenant/tenant.module";
import { LoggerModule } from "../logger/logger.module";
import { OrderModule } from "../order/order.module";
import { GatewayModule } from "../gateway/gateway.module";
import { NotificationModule } from "../notification/notification.module";

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Staff.name, schema: StaffSchema }]),
    TenantModule,
    LoggerModule,
    OrderModule,
    GatewayModule,
    NotificationModule, // R1: recordatorios 24h
  ],
  providers: [BookingService],
  controllers: [BookingController],
  exports: [BookingService],
})
export class BookingModule {}
