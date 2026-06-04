// ── WebSocket — contratos compartidos entre API y clientes ───────────────
//
// Rooms (canales de pub/sub en Socket.IO):
//
//   {tenantId}:table:{n}      → público, sin JWT — cliente final en mesa.
//   {tenantId}:order:{orderId}→ público, sin JWT — cliente takeaway/delivery.
//   {tenantId}:kitchen        → requiere JWT con role ∈ { kitchen, admin, superadmin }
//                               y tenantId que matchee (superadmin ignora tenantId).
//   {tenantId}:admin          → requiere JWT con role ∈ { admin, superadmin }
//                               y tenantId que matchee.
//
// Eventos: ver `SocketEvent`. Los payloads están tipados en `SocketEventMap`.
// El frontend debe usar estos nombres de evento para no romper el contrato.
//
// traceId: cada payload server→cliente lleva el `traceId` de la request que
// disparó la emisión. Es opcional porque eventos disparados desde un cron o
// flujo sin contexto de request pueden no tenerlo. El cliente lo loggea en
// dev (ver useSocketEvent) y se puede enviar al sink de logs si querés
// correlacionar acciones del usuario con la cadena del backend.

import type { Order, OrderStatus, PaymentStatus } from "./order.types";

// ── Eventos cliente → servidor ───────────────────────────────────────────

export interface JoinRoomPayload {
  room: string; // ej: "65a1...:kitchen" o "65a1...:table:5"
}

export interface JoinRoomAck {
  ok: boolean;
  room: string;
  error?: string;
}

// ── Eventos servidor → cliente ───────────────────────────────────────────

export const SocketEvent = {
  // Cocina + admin → entra una comanda nueva lista para preparar
  //   (pago aprobado vía webhook, admin verificó pagomóvil, o cajero cobró efectivo)
  NEW_ORDER: "new_order",

  // Admin → cliente pidió en efectivo, hay que cobrar
  NEW_CASH_ORDER: "new_cash_order",

  // Admin → cliente subió referencia de pagomóvil, hay que verificar
  PAYMENT_PENDING: "payment_pending",

  // Cliente (mesa) → su pago fue aprobado
  PAYMENT_APPROVED: "payment_approved",

  // Cliente (mesa) → su pago fue rechazado (pagomóvil) — incluye motivo
  PAYMENT_REJECTED: "payment_rejected",

  // Cliente (mesa) + cocina → cambió el estado de la comanda
  //   (preparing → ready → delivered, o cancelled)
  ORDER_STATUS_CHANGED: "order_status_changed",
} as const;

export type SocketEventName = (typeof SocketEvent)[keyof typeof SocketEvent];

// ── Payloads de eventos ──────────────────────────────────────────────────
//
// `traceId` viaja en TODOS los payloads server→cliente. Lo declaramos
// opcional por compat hacia atrás: una orden vieja en Mongo puede no tener
// `traceId` (se agregó en TRACE.2), entonces `effectiveTraceId` cae a `''`
// y el cliente lo ve como string vacío. En dev logueamos un warning.

interface TracedPayload {
  /**
   * Trace ID que correlaciona este evento con la request HTTP que lo originó.
   * Vacío ('') si la orden no tenía traceId persistido (legacy data).
   */
  traceId?: string;
}

export interface NewOrderPayload extends TracedPayload {
  order: Order;
}

export interface NewCashOrderPayload extends TracedPayload {
  order: Order;
}

export interface PaymentPendingPayload extends TracedPayload {
  orderId: string;
  tableNumber: number | null;
  total: number;
  pagomovil_reference: string;
  pagomovil_bank: string;
}

export interface PaymentApprovedPayload extends TracedPayload {
  orderId: string;
  tableNumber: number | null;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
}

export interface PaymentRejectedPayload extends TracedPayload {
  orderId: string;
  tableNumber: number | null;
  rejectionReason: string | null;
}

export interface OrderStatusChangedPayload extends TracedPayload {
  orderId: string;
  tableNumber: number | null;
  status: OrderStatus;
}

// ── Mapa para tipar emit/on en el cliente (opcional pero útil) ──────────

export interface SocketEventMap {
  [SocketEvent.NEW_ORDER]: NewOrderPayload;
  [SocketEvent.NEW_CASH_ORDER]: NewCashOrderPayload;
  [SocketEvent.PAYMENT_PENDING]: PaymentPendingPayload;
  [SocketEvent.PAYMENT_APPROVED]: PaymentApprovedPayload;
  [SocketEvent.PAYMENT_REJECTED]: PaymentRejectedPayload;
  [SocketEvent.ORDER_STATUS_CHANGED]: OrderStatusChangedPayload;
}

// ── Helpers para armar nombres de rooms de forma consistente ─────────────

export const roomName = {
  table: (tenantId: string, tableNumber: number) =>
    `${tenantId}:table:${tableNumber}`,
  order: (tenantId: string, orderId: string) => `${tenantId}:order:${orderId}`,
  kitchen: (tenantId: string) => `${tenantId}:kitchen`,
  admin: (tenantId: string) => `${tenantId}:admin`,
};
