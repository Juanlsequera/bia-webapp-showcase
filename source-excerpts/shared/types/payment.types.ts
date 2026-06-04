// ── Cierre de caja / payment transactions ──────────────────────────────
//
// Tipos compartidos entre `apps/api` (PaymentController) y `apps/web`
// (CajaPage) para el "cerrar caja" diario.

export type PaymentTransactionStatus =
  | "pending_review"
  | "approved"
  | "rejected";
export type PaymentTransactionMethod =
  | "pagomovil"
  | "cash"
  | "stripe"
  | "mercadopago"
  | "debit_card";

/** Crosscheck del beneficiario del recibo vs config del tenant. */
export type PaymentCrossCheck = "match" | "mismatch" | "unknown";

/**
 * Una fila de la tabla "cerrar caja". Es una vista plana de la transacción
 * (sin Mongo internals) lista para renderizar.
 */
export interface PaymentTransactionListItem {
  _id: string;
  orderId: string;
  traceId: string;
  method: PaymentTransactionMethod;
  status: PaymentTransactionStatus;
  /** Monto declarado por el cliente. Bs. para pagomovil y debit_card, USD para el resto. */
  amount: number;
  reference: string | null;
  senderPhone: string | null;
  senderBank: string | null;
  beneficiaryPhone: string | null;
  beneficiaryBank: string | null;
  crossCheckStatus: PaymentCrossCheck;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectionReason: string | null;
  /** URL pública del comprobante en Cloudinary. Null para transacciones pre-P1.13. */
  receipt_url: string | null;
  createdAt: string;
}

/**
 * Totales del cierre. Un objeto plano con todo lo que el dueño quiere ver
 * de un vistazo: cuánto entró, cuánto se rechazó, cuánto sigue pendiente.
 *
 * NOTA sobre monedas: hoy `amount` mezcla Bs. (pagomovil) y USD (resto).
 * Por eso devolvemos los totales **separados por método**: cada método
 * tiene su propia moneda inferida. El frontend formatea según corresponda.
 */
export interface PaymentClosingSummary {
  /** Rango efectivo, útil para mostrar en el header de la página. */
  periodLabel: string;

  /** Totales globales. Monedas mixtas — sólo útil como conteo. */
  totalCount: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;

  /** Por método. `amount` está en la moneda de ese método (Bs. para pagomovil). */
  byMethod: Array<{
    method: PaymentTransactionMethod;
    count: number;
    /** Suma de `amount` de las APROBADAS de este método. */
    approvedAmount: number;
    /** Suma de `amount` de las que siguen en `pending_review`. */
    pendingAmount: number;
  }>;
}

export interface PaymentTransactionsResponse {
  data: PaymentTransactionListItem[];
  total: number;
  page: number;
  limit: number;
  /** Resumen agregado de TODO el rango filtrado (no solo la página). */
  summary: PaymentClosingSummary;
}
