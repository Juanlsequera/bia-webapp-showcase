import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type PaymentLinkDocument = PaymentLink & Document;

/**
 * PaymentLink — enlace de cobro generado por el admin.
 *
 * Caso de uso primario: taxi/transporte. El conductor crea un link
 * con el monto del viaje y se lo comparte al pasajero por WhatsApp/SMS.
 * El pasajero abre la página pública y paga sin instalar nada.
 */
@Schema({ timestamps: true, collection: "payment_links" })
export class PaymentLink {
  @Prop({ type: Types.ObjectId, ref: "Tenant", required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true })
  tenantSlug: string;

  /** Quién generó el link (userId del admin/kitchen) */
  @Prop({ type: Types.ObjectId, ref: "User", required: true })
  createdBy: Types.ObjectId;

  /** Descripción visible al cliente: "Viaje aeropuerto", "Servicio plomería" */
  @Prop({ required: true, trim: true, maxlength: 200 })
  description: string;

  /** Monto en USD */
  @Prop({ required: true, type: Number, min: 0.01 })
  amount: number;

  /** Notas internas — el cliente NO las ve */
  @Prop({ type: String, default: null, trim: true, maxlength: 500 })
  internalNote: string | null;

  /** Nombre del cliente (opcional, para mostrar en la página de pago) */
  @Prop({ type: String, default: null, trim: true, maxlength: 100 })
  customerName: string | null;

  /**
   * Método de pago seleccionado por el admin al crear el link.
   * Determina qué card ve el cliente y qué endpoints puede llamar.
   */
  @Prop({
    type: String,
    enum: ["pagomovil", "transfer", "zelle"],
    default: "pagomovil",
  })
  paymentMethod: "pagomovil" | "transfer" | "zelle";

  /** ObjectId de la cuenta del tenant seleccionada al crear el link */
  @Prop({ type: String, default: null })
  paymentAccountId: string | null;

  /**
   * Snapshot inmutable de los datos de la cuenta al momento de crear el link.
   * Permite mostrar los datos correctos al cliente aunque el admin modifique la cuenta después.
   */
  @Prop({ type: Object, default: null })
  paymentAccountSnapshot: Record<string, unknown> | null;

  /**
   * Estado del link.
   *   - `active`: esperando que el cliente pague.
   *   - `pending_verification`: el cliente subió comprobante — admin debe revisar.
   *   - `paid`: admin confirmó el pago.
   *   - `expired`: pasó la fecha `expiresAt`.
   *   - `cancelled`: admin canceló el link antes de cobrar.
   */
  @Prop({
    type: String,
    enum: ["active", "pending_verification", "paid", "expired", "cancelled"],
    default: "active",
    index: true,
  })
  status: "active" | "pending_verification" | "paid" | "expired" | "cancelled";

  /** Fecha de expiración (null = no expira) */
  @Prop({ default: null, type: Date })
  expiresAt: Date | null;

  /** Cuándo se marcó como pagado */
  @Prop({ default: null, type: Date })
  paidAt: Date | null;

  /** Método de pago con el que se saldó */
  @Prop({ type: String, default: null })
  paidWith: string | null;

  /** traceId del request de pago */
  @Prop({ type: String, default: null })
  paidTraceId: string | null;

  // ── PagoMóvil submission (cliente carga comprobante desde la página pública) ──

  /** Referencia/comprobante del PagoMóvil que el cliente cargó */
  @Prop({ type: String, default: null, trim: true })
  pagomovil_reference: string | null;

  /** Teléfono PagoMóvil del cliente que pagó */
  @Prop({ type: String, default: null, trim: true })
  pagomovil_phone: string | null;

  /** Banco del cliente (opcional) */
  @Prop({ type: String, default: null, trim: true })
  pagomovil_bank: string | null;

  /** Monto en Bs al que pagó el cliente (snapshot a la tasa del momento) */
  @Prop({ type: Number, default: null })
  pagomovil_amount_bs: number | null;

  /** URL Cloudinary del comprobante */
  @Prop({ type: String, default: null })
  pagomovil_receipt_url: string | null;

  /** Public ID Cloudinary (para cleanup) */
  @Prop({ type: String, default: null })
  pagomovil_receipt_public_id: string | null;

  /** Cuándo subió el comprobante */
  @Prop({ type: Date, default: null })
  pagomovil_submitted_at: Date | null;

  /** Teléfono beneficiario extraído por OCR (cross-check con el banco del tenant) */
  @Prop({ type: String, default: null })
  pagomovil_beneficiary_phone: string | null;

  /** Banco beneficiario extraído por OCR */
  @Prop({ type: String, default: null })
  pagomovil_beneficiary_bank: string | null;

  /** Resultado del cross-check vs banco configurado del tenant */
  @Prop({
    type: String,
    default: null,
    enum: ["match", "mismatch", "unknown", null],
  })
  pagomovil_crosscheck: "match" | "mismatch" | "unknown" | null;

  /** Fecha del comprobante extraída por OCR (dd/mm/yyyy) */
  @Prop({ type: String, default: null })
  pagomovil_date: string | null;

  // ── Transferencia bancaria submission ────────────────────────────────────

  @Prop({ type: String, default: null })
  transfer_receipt_url: string | null;

  @Prop({ type: String, default: null })
  transfer_receipt_public_id: string | null;

  @Prop({ type: String, default: null, trim: true })
  transfer_reference: string | null;

  /** Monto pagado según el comprobante (en la moneda de la cuenta) */
  @Prop({ type: Number, default: null })
  transfer_amount: number | null;

  @Prop({ type: String, default: null, enum: ["VES", "USD", null] })
  transfer_currency: string | null;

  @Prop({ type: String, default: null, trim: true })
  transfer_sender_name: string | null;

  @Prop({ type: String, default: null })
  transfer_date: string | null;

  @Prop({ type: Date, default: null })
  transfer_submitted_at: Date | null;

  /** Resultado del cross-check monto OCR vs monto del link */
  @Prop({
    type: String,
    default: null,
    enum: ["match", "mismatch", "unknown", null],
  })
  transfer_crosscheck: "match" | "mismatch" | "unknown" | null;

  // ── Zelle submission ─────────────────────────────────────────────────────

  @Prop({ type: String, default: null })
  zelle_receipt_url: string | null;

  @Prop({ type: String, default: null })
  zelle_receipt_public_id: string | null;

  @Prop({ type: Number, default: null })
  zelle_amount: number | null;

  @Prop({ type: String, default: null, trim: true })
  zelle_reference: string | null;

  @Prop({ type: String, default: null, trim: true })
  zelle_sender_name: string | null;

  @Prop({ type: String, default: null, trim: true })
  zelle_sender_email: string | null;

  @Prop({ type: String, default: null })
  zelle_date: string | null;

  @Prop({ type: Date, default: null })
  zelle_submitted_at: Date | null;

  /** Resultado del cross-check monto OCR vs monto del link */
  @Prop({
    type: String,
    default: null,
    enum: ["match", "mismatch", "unknown", null],
  })
  zelle_crosscheck: "match" | "mismatch" | "unknown" | null;
}

export const PaymentLinkSchema = SchemaFactory.createForClass(PaymentLink);
