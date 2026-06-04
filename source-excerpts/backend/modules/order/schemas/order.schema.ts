import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { ORDER_ARCHETYPES, type OrderArchetype } from "@foodorder/types";
import { Document, Types } from "mongoose";

export type OrderDocument = Order & Document;

// Desnormalizado intencionalmente: si el precio cambia, el historial queda correcto
@Schema({ _id: false })
class OrderItem {
  @Prop({ type: Types.ObjectId, ref: "Product", required: true })
  productId: Types.ObjectId;

  @Prop({ required: true }) productName: string;
  @Prop({ required: true }) productCategory: string;
  @Prop({ required: true, min: 1 }) quantity: number;
  @Prop({ required: true, min: 0 }) unitPrice: number;
  @Prop({ type: String, default: null }) notes: string | null;
}

@Schema({ _id: false })
class PaymentInfo {
  @Prop({
    required: true,
    enum: [
      "cash",
      "stripe",
      "mercadopago",
      "pagomovil",
      "debit_card",
      "bank_transfer",
      "card_online",
    ],
  })
  method: string;

  // Estados del pago:
  // pending             → pago iniciado, esperando acción
  // pending_verification→ cliente envió datos de pagomovil, admin debe verificar
  // approved            → pago confirmado (por webhook, admin o cajero)
  // rejected            → rechazado
  @Prop({
    required: true,
    enum: ["pending", "pending_verification", "approved", "rejected"],
    default: "pending",
  })
  status: string;

  @Prop({ type: String, default: null }) externalId: string | null;
  @Prop({ type: Date, default: null }) paidAt: Date | null;

  // ── Campos de PagoMóvil (validación manual) ──
  // El cliente los ingresa después de hacer la transferencia
  @Prop({ type: String, default: null }) pagomovil_reference: string | null; // número de referencia del banco
  @Prop({ type: String, default: null }) pagomovil_phone: string | null; // teléfono desde el cual pagó
  @Prop({ type: String, default: null }) pagomovil_bank: string | null; // banco emisor
  @Prop({ type: String, default: null }) pagomovil_cedula: string | null; // cédula del pagador
  @Prop({ type: Number, default: null }) pagomovil_amount: number | null; // monto que dice haber transferido
  @Prop({ type: String, default: null }) pagomovil_date: string | null; // fecha del comprobante extraída por OCR (dd/mm/yyyy)

  // Los rellena el admin al verificar
  @Prop({ type: String, default: null }) pagomovil_verified_by: string | null;
  @Prop({ type: Date, default: null }) pagomovil_verified_at: Date | null;
  @Prop({ type: String, default: null }) pagomovil_rejection_reason:
    | string
    | null;

  // ── Comprobante PagoMóvil subido a Cloudinary ──
  // El cliente sube el screenshot antes de enviar el form; el backend lo
  // persiste acá y luego lo copia al PaymentTransaction al hacer el PATCH.
  @Prop({ type: String, default: null }) pagomovil_receipt_url: string | null;
  @Prop({ type: String, default: null }) pagomovil_receipt_public_id:
    | string
    | null;

  // ── Auto-aprobación LLM ───────────────────────────────────────────────────
  // Campos populados por el pipeline de extracción LLM al procesar el comprobante.
  // Permiten al admin ver la confianza del OCR y si la imagen fue marcada como sospechosa.

  /** Nivel de confianza del OCR al extraer el comprobante ("high" | "medium" | "low"). */
  @Prop({ type: String, default: null }) pagomovil_ocr_confidence: string | null;

  /**
   * El LLM detectó señales de manipulación en la imagen del comprobante.
   * true = sospechoso (bloquea la auto-aprobación). null = no evaluado aún.
   */
  @Prop({ type: Boolean, default: null }) pagomovil_suspicious: boolean | null;

  /**
   * La orden fue aprobada automáticamente por el pipeline LLM (sin intervención admin).
   * Se registra para auditoría y para poder filtrar auto-aprobadas vs manuales en analytics.
   */
  @Prop({ type: Boolean, default: false }) pagomovil_auto_approved: boolean;

  // ── Efectivo (lo rellena el cajero al confirmar el cobro) ──
  @Prop({ type: String, default: null }) confirmed_by: string | null;

  // ── Cancelación (cualquier método — lo registra quien cancela) ──
  @Prop({ type: String, default: null }) cancellation_reason: string | null;
  @Prop({ type: String, default: null }) cancelled_by: string | null;

  // ── Seña (deposit) — solo para booking archetype ──────────────────
  // Snapshot inmutable del porcentaje y monto de seña al crear la reserva.
  // Si el negocio cambia el % después, las órdenes previas mantienen su seña original.
  @Prop({ type: Number, default: 0 }) deposit_pct: number; // 0-100
  @Prop({ type: Number, default: 0 }) deposit_amount: number; // monto USD cobrado
}

/**
 * Snapshot del pricing al crear la orden. Inmutable: si la tasa BCV cambia
 * después, el cliente sigue pagando lo que vio cuando confirmó. Esto evita
 * disputas tipo "yo vi otro precio cuando agregué al carrito".
 */
@Schema({ _id: false })
class OrderPricingInfo {
  @Prop({ required: true, min: 0 }) total_usd: number;
  @Prop({ required: true, min: 0 }) usd_rate: number;
  @Prop({ type: Date, required: true }) rate_captured_at: Date;
  @Prop({ required: true, min: 0 }) total_bs: number;
  @Prop({ required: true, default: false }) rate_stale: boolean;
}

@Schema({ timestamps: true, collection: "orders" })
export class Order {
  @Prop({ type: Types.ObjectId, ref: "Tenant", required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true }) tenantSlug: string; // desnormalizado para queries rápidas

  @Prop({
    required: true,
    enum: ["dine_in", "takeaway", "delivery"],
    default: "dine_in",
  })
  orderType: string;

  @Prop({
    type: String,
    required: true,
    enum: ORDER_ARCHETYPES,
    default: "food",
    index: true,
  })
  archetype: OrderArchetype;

  // null para takeaway/delivery
  @Prop({ type: Number, default: null, min: 1 }) tableNumber: number | null;

  // Obligatorio para takeaway/delivery. Cocina canta el nombre al entregar.
  @Prop({ type: String, default: null }) customer_name: string | null;

  // Código corto generado server-side para takeaway. Ej: 'T-07'.
  @Prop({ type: String, default: null, index: true }) pickup_code:
    | string
    | null;

  @Prop({ type: [OrderItem], required: true }) items: OrderItem[];

  @Prop({
    required: true,
    enum: [
      // ── food / retail ──────────────────────────────────
      "confirmed",
      "pending_verification",
      "pending_cash",
      "paid",
      "preparing",
      "ready",
      "delivered",
      "cancelled",
      // ── booking ────────────────────────────────────────
      "scheduled",
      "reminder_sent", // recordatorio 24h enviado (booking.service.ts lo setea vía updateOne)
      "no_show",
      "rescheduled",
      "in_progress",
      "completed",
      // ── services ───────────────────────────────────────
      "inquiry",
      "quoted",
      "approved",
    ],
    default: "confirmed",
    index: true,
  })
  status: string;

  /** Total en USD. `items[].unitPrice` también está en USD desde el catálogo. */
  @Prop({ required: true, min: 0 }) total: number;

  /**
   * Pricing en USD y Bs según la tasa BCV vigente al crear la orden.
   * Inmutable después de la creación. Ver OrderPricingInfo.
   */
  @Prop({ type: OrderPricingInfo, required: true }) pricing: OrderPricingInfo;

  // Opcional: teléfono del cliente para avisarle por WhatsApp o push
  @Prop({ type: String, default: null }) customer_phone: string | null;

  // Opcional: email del cliente para confirmación por correo (booking archetype)
  @Prop({ type: String, default: null }) customer_email: string | null;

  @Prop({ type: PaymentInfo, required: true }) payment: PaymentInfo;

  /**
   * TraceId del request que creó la orden. Lo propagamos a todos los eventos
   * WebSocket y a cada PaymentTransaction asociada — así, si algo sale mal,
   * podemos ver en logs de back + front toda la cadena del mismo caso.
   * Indexado porque soporte va a buscar "la orden del traceId X".
   */
  @Prop({ type: String, default: null, index: true })
  traceId: string | null;

  /**
   * Booking: ID del profesional asignado. Solo se llena si archetype === 'booking'.
   * Indexado para queries rápidas del agenda admin (GET /admin/bookings?staffId=...).
   * sparse=true: excluye del índice los docs con staffId=null (órdenes food/retail/services).
   */
  @Prop({
    type: Types.ObjectId,
    ref: "Staff",
    default: null,
    index: true,
    sparse: true,
  })
  staffId: Types.ObjectId | null;

  /**
   * SEC-01: Token aleatorio (64 hex chars) generado al crear una reserva.
   * Solo se incluye en el email/WhatsApp de confirmación — nunca en respuestas API.
   * Requerido para que el cliente cancele o reprograme sin estar autenticado.
   * null en órdenes no-booking y en órdenes anteriores al rollout de esta feature.
   */
  @Prop({ type: String, default: null })
  cancellation_token: string | null;

  /**
   * Booking: Datetime de la cita (ISO 8601). Solo se llena si archetype === 'booking'.
   * sparse=true: igual que staffId — no indexar órdenes no-booking.
   */
  @Prop({ type: Date, default: null, index: true, sparse: true })
  bookingDatetime: Date | null;

  // ── Service / Cotización ─────────────────────────────────────────────────────

  /**
   * Monto cotizado por el admin (en USD). null = sin cotizar aún (estado inquiry).
   * Se setea junto con la transición inquiry → quoted.
   */
  @Prop({ type: Number, default: null })
  quote_amount: number | null;

  /** Notas del admin al enviar la cotización (descripción del trabajo, desglose, etc.). */
  @Prop({ type: String, default: null })
  quote_notes: string | null;

  // ── Timestamps de transición de estado (analytics de cocina) ──────────────
  @Prop({ type: Date, default: null }) preparingAt: Date | null;
  @Prop({ type: Date, default: null }) readyAt: Date | null;
  @Prop({ type: Date, default: null }) deliveredAt: Date | null;
  @Prop({ type: Date, default: null }) cancelledAt: Date | null;

  // ── Número de pedido diario ────────────────────────────────────────────────
  /** Número secuencial dentro del día de negocio del tenant (1, 2, 3…). */
  @Prop({ type: Number, default: null, index: true })
  orderNumber: number | null;

  /**
   * Fecha de negocio del tenant en formato 'YYYY-MM-DD'.
   * Puede diferir de `createdAt` si `day_cutoff_hour > 0` (negocios nocturnos).
   */
  @Prop({ type: String, default: null })
  orderDate: string | null;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// Índices compuestos para analytics y panel cocina
OrderSchema.index({ tenantId: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, status: 1 });
OrderSchema.index({ tenantId: 1, "payment.status": 1 });
OrderSchema.index({ tenantId: 1, "payment.method": 1 });
OrderSchema.index({ tenantId: 1, createdAt: -1, "payment.status": 1 });
OrderSchema.index({ "items.productId": 1, tenantId: 1 });
OrderSchema.index({ tenantId: 1, orderType: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, archetype: 1, createdAt: -1 });
OrderSchema.index({ tenantId: 1, orderDate: 1 });
OrderSchema.index(
  { tenantId: 1, staffId: 1, bookingDatetime: 1 },
  { sparse: true },
);
OrderSchema.index(
  { tenantId: 1, archetype: 1, staffId: 1, status: 1 },
  { sparse: true },
);
