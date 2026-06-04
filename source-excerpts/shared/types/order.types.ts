// ── Enums ────────────────────────────────────────────────────────────────

export type OrderType = "dine_in" | "takeaway" | "delivery";

// Arquetipos multi-tenant (nueva iteración)
export type OrderArchetype = "food" | "retail" | "booking" | "service";
export const ORDER_ARCHETYPES: readonly OrderArchetype[] = [
  "food",
  "retail",
  "booking",
  "service",
] as const;
export type FulfillmentType = "delivery" | "pickup" | "onsite" | "remote";

export type OrderStatus =
  // legacy food
  | "confirmed"
  | "pending_verification"
  | "pending_cash"
  | "paid"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled"
  // nuevos estados multi-arquetipo
  | "pending"
  | "payment_review"
  | "processing"
  | "shipped"
  | "returned"
  | "in_kitchen"
  | "reminder_sent"
  | "in_progress"
  | "completed"
  | "no_show"
  | "rescheduled"
  | "inquiry"
  | "quoted"
  | "approved"
  | "scheduled";

export type PaymentMethod =
  | "cash"
  | "stripe"
  | "mercadopago"
  | "pagomovil"
  | "debit_card"
  | "bank_transfer"
  | "card_online";

export type PaymentStatus =
  | "pending"
  | "pending_verification"
  | "approved"
  | "rejected";

// ── Sub-documentos ───────────────────────────────────────────────────────

export interface OrderCustomer {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  dni?: string | null;
}

export interface DeliveryAddress {
  line1: string;
  line2?: string | null;
  city?: string | null;
  reference?: string | null;
}

export interface OrderItem {
  productId: string;
  productName: string;
  productCategory: string;
  quantity: number;
  unitPrice: number;
  notes?: string | null;
}

export interface OrderPayment {
  method: PaymentMethod;
  status: PaymentStatus;
  externalId?: string | null;
  paidAt?: Date | null;

  // Pagomóvil (validación manual — rellena el cliente)
  pagomovil_reference?: string | null;
  pagomovil_phone?: string | null;
  pagomovil_bank?: string | null;
  pagomovil_cedula?: string | null;
  pagomovil_amount?: number | null;
  pagomovil_date?: string | null;

  // Pagomóvil — comprobante subido a Cloudinary (P1.13)
  pagomovil_receipt_url?: string | null;
  pagomovil_receipt_public_id?: string | null;

  // Pagomóvil (rellena el admin al verificar)
  pagomovil_verified_by?: string | null;
  pagomovil_verified_at?: Date | null;
  pagomovil_rejection_reason?: string | null;

  // Efectivo (rellena el cajero al confirmar el cobro)
  confirmed_by?: string | null;

  // Cancelación — cualquier método (registra quien cancela y el motivo)
  cancellation_reason?: string | null;
  cancelled_by?: string | null;
}

// ── Documento principal ──────────────────────────────────────────────────

export interface Order {
  _id: string;
  tenantId: string;
  tenantSlug: string;
  /** 'dine_in' (default/legacy) | 'takeaway' | 'delivery' */
  orderType: OrderType;
  /** Arquetipo de negocio — distingue el tipo de negocio detrás de la orden. Default: 'food'. */
  archetype: OrderArchetype;
  /** null para takeaway/delivery */
  tableNumber: number | null;
  /** Nombre del cliente — obligatorio para takeaway/delivery */
  customer_name?: string | null;
  /** Código corto generado server-side para takeaway. Ej: 'T-07' */
  pickup_code?: string | null;
  items: OrderItem[];
  status: OrderStatus;
  /** Total en USD — `items.unitPrice` ya viene en USD desde el catálogo. */
  total: number;
  customer_phone?: string | null;
  payment: OrderPayment;
  /**
   * Snapshot de la conversión USD→Bs en el momento de crear la orden.
   * Inmutable. El cliente paga `pricing.total_bs` aunque BCV cambie después.
   * Tipo importado vía barrel para evitar dependencia circular.
   */
  pricing: import("./bcv.types").OrderPricing;
  /** Booking: ID del profesional asignado. Solo se llena si archetype === 'booking'. */
  staffId?: string | null;
  /** Booking: datetime de la cita (ISO 8601). Solo se llena si archetype === 'booking'. */
  bookingDatetime?: string | null;
  /** Service: monto cotizado por el admin (USD). null = sin cotizar aún. */
  quote_amount?: number | null;
  /** Service: notas del admin al enviar la cotización. */
  quote_notes?: string | null;
  traceId?: string | null;
  /** Número secuencial del pedido dentro del "día de negocio" del tenant (1, 2, 3…).
   *  null en órdenes anteriores al rollout de esta feature. */
  orderNumber?: number | null;
  /** Fecha de negocio del tenant ('YYYY-MM-DD'). Puede diferir del día UTC si
   *  day_cutoff_hour > 0. null en órdenes anteriores al rollout. */
  orderDate?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ── DTOs de request ──────────────────────────────────────────────────────

export interface CreateOrderDto {
  orderType?: OrderType; // Optional, defaults to 'dine_in'
  /** Requerido cuando orderType === 'dine_in' */
  tableNumber?: number;
  /** Requerido cuando orderType !== 'dine_in' */
  customer_name?: string;
  items: Array<Pick<OrderItem, "productId" | "quantity" | "notes">>;
  paymentMethod: PaymentMethod;
  customer_phone?: string;
  /** Arquetipo. Si no se envía, el server lo deriva de tenant.business_types[0]. Default: 'food'. */
  archetype?: OrderArchetype;
  /** Booking: ID del profesional asignado. Requerido si archetype === 'booking'. */
  staffId?: string | null;
  /** Booking: datetime de la cita (ISO 8601). Requerido si archetype === 'booking'. */
  bookingDatetime?: string | null;
}

export interface SubmitPagomovilDto {
  pagomovil_reference: string;
  pagomovil_phone: string;
  pagomovil_bank: string;
  pagomovil_cedula: string;
  pagomovil_amount: number;
}

export interface VerifyPagomovilDto {
  decision: "approved" | "rejected";
  rejection_reason?: string;
}

export interface UpdateOrderStatusDto {
  status: Extract<
    OrderStatus,
    "preparing" | "ready" | "delivered" | "cancelled"
  >;
}

export interface ConfirmCashPaymentDto {
  notes?: string;
}

// ── Respuestas ───────────────────────────────────────────────────────────

export interface OrderStatusResponse {
  orderId: string;
  tenantId?: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMethod?: PaymentMethod;
  orderType?: string | null;
  archetype?: string;
  tableNumber?: number | null;
  pickup_code?: string | null;
  customer_name?: string | null;
  total: number;
  pricing?: import("./bcv.types").OrderPricing;
  rejectionReason: string | null;
  traceId?: string | null;
  /** Número secuencial del pedido en el día de negocio. null = orden legacy. */
  orderNumber?: number | null;
  /** Fecha de negocio del tenant ('YYYY-MM-DD'). */
  orderDate?: string | null;
}
