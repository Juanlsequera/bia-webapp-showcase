import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { PaymentLink, PaymentLinkSchema } from "./schemas/payment-link.schema";
import { PaymentLinkService } from "./payment-link.service";
import {
  PaymentLinkAdminController,
  PaymentLinkPublicController,
} from "./payment-link.controller";
import { TenantModule } from "../tenant/tenant.module";
import { MediaModule } from "../media/media.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentLink.name, schema: PaymentLinkSchema },
    ]),
    TenantModule,
    MediaModule,
  ],
  controllers: [PaymentLinkAdminController, PaymentLinkPublicController],
  providers: [PaymentLinkService],
  exports: [PaymentLinkService],
})
export class PaymentLinkModule {}
