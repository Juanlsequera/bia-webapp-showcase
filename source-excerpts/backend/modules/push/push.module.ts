import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { PushService } from "./push.service";
import { PushController } from "./push.controller";
import {
  PushSubscription,
  PushSubscriptionSchema,
} from "./schemas/push-subscription.schema";
import { Order, OrderSchema } from "../order/schemas/order.schema";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PushSubscription.name, schema: PushSubscriptionSchema },
      // Necesitamos Order para validar orderId en el controller
      { name: Order.name, schema: OrderSchema },
    ]),
  ],
  controllers: [PushController],
  providers: [PushService],
  exports: [PushService],
})
export class PushModule {}
