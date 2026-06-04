import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import {
  PaymentTransaction,
  PaymentTransactionSchema,
} from "./schemas/payment-transaction.schema";
import { CajaArqueo, CajaArqueoSchema } from "./schemas/caja-arqueo.schema";
import { PaymentTransactionService } from "./payment-transaction.service";
import { PaymentController } from "./payment.controller";
import { AuthModule } from "../auth/auth.module";

/**
 * PaymentModule
 *
 * Agrupa todo lo relacionado a pagos que antes vivía desperdigado en
 * `order.service` (campos de pagomóvil embebidos en la orden).
 *
 * Contiene:
 *   - `payment_transactions` — audit log de cada intento de pago.
 *   - `PaymentController` — endpoints `/admin/payments/*` para cerrar caja.
 *
 * En el futuro va a hospedar también los endpoints de MercadoPago/Stripe y
 * sus webhooks.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: PaymentTransaction.name, schema: PaymentTransactionSchema },
      { name: CajaArqueo.name, schema: CajaArqueoSchema },
    ]),
    AuthModule, // JwtAuthGuard / RolesGuard
  ],
  controllers: [PaymentController],
  providers: [PaymentTransactionService],
  exports: [PaymentTransactionService],
})
export class PaymentModule {}
