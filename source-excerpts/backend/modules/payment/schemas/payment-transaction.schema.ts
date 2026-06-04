import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type PaymentTransactionDocument = PaymentTransaction & Document;

/**
 * PaymentTransaction — registro inmutable (append + updates puntuales de
 * review) de cada intento de pago. Vive aparte de `orders` por dos razones:
 *
 *   1. **Cerrar caja**: el dueño del negocio al final del día quiere sacar
 *      un listado de "todas las transferencias que entraron hoy, aprobadas
 *      y rechazadas". Esa query toca `payment_transactions` directamente
 *      sin pelearse con el ciclo de vida de la orden (preparing/ready/...).
 *
 *   2. **Auditoría**: si una orden se modifica (cancelación, reembolso,
 *      correcciones), el historial de transacciones queda intacto. No
 *      perdemos el rastro de qué comprobante mandó el cliente.
 *
 * Una orden puede tener N transactions (ej: rechazamos el primero y el
 * cliente reintenta). Por eso `orderId` es un ref — no hay unique.
 */
@Schema({ timestamps: true, collection: "payment_transactions" })
export class PaymentTransaction {
  @Prop({ type: Types.ObjectId, ref: "Tenant", required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: "Order", required: true, index: true })
  orderId: Types.ObjectId;

  /** ID único de trace para correlacionar con logs back + front. */
  @Prop({ type: String, required: true, index: true })
  traceId: string;

  /** Método del pago (sólo pagomovil hoy; deja abierto para cash/stripe/mp). */
  @Prop({
    type: String,
    required: true,
    enum: ["pagomovil", "cash", "stripe", "mercadopago", "debit_card"],
    index: true,
  })
  method: string;

  /**
   * Estado del review:
   * - pending_review → cliente submit, admin aún no verificó
   * - approved       → admin validó y marcó como OK
   * - rejected       → admin validó y rechazó (ver rejectionReason)
   */
  @Prop({
    type: String,
    required: true,
    enum: ["pending_review", "approved", "rejected"],
    default: "pending_review",
    index: true,
  })
  status: string;

  /** Monto declarado por el cliente (Bs. para pagomovil, USD para el resto). */
  @Prop({ type: Number, required: true, min: 0 })
  amount: number;

  // ── Datos específicos de PagoMóvil ──
  @Prop({ type: String, default: null }) reference: string | null;
  @Prop({ type: String, default: null }) senderPhone: string | null;
  @Prop({ type: String, default: null }) senderBank: string | null;

  /** Lo que el OCR extrajo del recibo (útil para auditoría — ¿mandó al tel correcto?). */
  @Prop({ type: String, default: null }) beneficiaryPhone: string | null;
  @Prop({ type: String, default: null }) beneficiaryBank: string | null;

  /**
   * Resultado del cross-check beneficiario (del recibo) vs config del tenant.
   * Sirve para filtrar rápido "transferencias que fueron al número equivocado".
   */
  @Prop({
    type: String,
    enum: ["match", "mismatch", "unknown"],
    default: "unknown",
  })
  crossCheckStatus: string;

  // ── Comprobante subido a Cloudinary (P1.13) ──
  // Copiado del Order.payment.pagomovil_receipt_url al crear la transacción.
  @Prop({ type: String, default: null }) receipt_url: string | null;

  // ── Review del admin ──
  @Prop({ type: String, default: null }) reviewedBy: string | null;
  @Prop({ type: Date, default: null }) reviewedAt: Date | null;
  @Prop({ type: String, default: null }) rejectionReason: string | null;
}

export const PaymentTransactionSchema =
  SchemaFactory.createForClass(PaymentTransaction);

// Índices compuestos para cerrar caja y auditoría.
// - Listado del día por tenant ordenado por fecha.
PaymentTransactionSchema.index({ tenantId: 1, createdAt: -1 });
// - "Transacciones aprobadas de hoy" — query más pesada al cerrar caja.
PaymentTransactionSchema.index({ tenantId: 1, status: 1, createdAt: -1 });
// - Buscar todas las transacciones de una orden (reintentos, historial).
PaymentTransactionSchema.index({ orderId: 1, createdAt: -1 });
// - Buscar por referencia (duplicate detection y soporte al cliente).
PaymentTransactionSchema.index({ tenantId: 1, reference: 1 });
