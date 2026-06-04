import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { QrPage, QrPageSchema } from "./schemas/qr-page.schema";
import { QrPageService } from "./qr-page.service";
import {
  QrPageAdminController,
  QrPagePublicController,
} from "./qr-page.controller";
import { TenantModule } from "../tenant/tenant.module";
import { MenuModule } from "../menu/menu.module";
import { PaymentLinkModule } from "../payment-link/payment-link.module";

/**
 * QrPageModule — páginas de cobro permanentes con QR estático.
 *
 * Feature ESTÁNDAR: disponible para todos los tenants sin restricción de plan.
 * No requiere módulo habilitado en TenantConfig.
 *
 * Endpoints:
 *   Admin (JWT admin):
 *     POST   /admin/qr-pages
 *     GET    /admin/qr-pages
 *     GET    /admin/qr-pages/:id
 *     PATCH  /admin/qr-pages/:id
 *     DELETE /admin/qr-pages/:id
 *
 *   Público (sin auth):
 *     GET  /:tenantSlug/qr/:shortCode
 *     POST /:tenantSlug/qr/:shortCode/pay
 */
@Module({
  imports: [
    MongooseModule.forFeature([{ name: QrPage.name, schema: QrPageSchema }]),
    TenantModule,
    MenuModule,
    PaymentLinkModule,
  ],
  controllers: [QrPageAdminController, QrPagePublicController],
  providers: [QrPageService],
  exports: [QrPageService],
})
export class QrPageModule {}
