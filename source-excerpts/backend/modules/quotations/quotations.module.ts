import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { Quotation, QuotationSchema } from "./schemas/quotation.schema";
import { QuotationsService } from "./quotations.service";
import { QuotationsController } from "./quotations.controller";
import { AuthModule } from "../auth/auth.module";
import { TenantModule } from "../tenant/tenant.module";

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Quotation.name, schema: QuotationSchema },
    ]),
    AuthModule,
    TenantModule, // provee ModuleEnabledGuard + modelo Tenant
  ],
  controllers: [QuotationsController],
  providers: [QuotationsService],
  exports: [QuotationsService],
})
export class QuotationsModule {}
