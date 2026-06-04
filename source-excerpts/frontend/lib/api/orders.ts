import { api } from "./client";
import type { Order, OrderStatusResponse } from "@foodorder/types";

// ── Tipos de payloads (DTOs) ─────────────────────────────────────────────
// Mantener acá los shapes de request hace que el call-site del page no
// tenga que conocer la forma exacta, solo invocar la función.

export interface CreateOrderItem {
  productId: string;
  quantity: number;
  notes?: string;
}

export interface CreateOrderDto {
  orderType: "dine_in" | "takeaway" | "delivery";
  tableNumber?: number;
  customer_name?: string;
  items: CreateOrderItem[];
  paymentMethod: "cash" | "debit_card" | "pagomovil" | "stripe" | "mercadopago";
  customer_phone?: string;
}

export interface SubmitPagomovilDto {
  pagomovil_reference: string;
  pagomovil_phone: string;
  pagomovil_bank: string;
  pagomovil_amount: number;
  pagomovil_cedula?: string;
  pagomovil_beneficiary_phone?: string;
  pagomovil_beneficiary_bank?: string;
  pagomovil_crosscheck?: "match" | "mismatch" | "unknown";
  pagomovil_date?: string;
}

export interface VerifyPagomovilDto {
  decision: "approved" | "rejected";
  rejection_reason?: string;
}

export interface UpdateOrderStatusDto {
  status: "preparing" | "ready" | "delivered" | "cancelled";
  cancellation_reason?: string;
}

export const ordersApi = {
  // ── Cliente (sin auth) ─────────────────────────────────────────────────
  create: (tenantSlug: string, dto: CreateOrderDto) =>
    api.post<Order>(`/${tenantSlug}/orders`, dto).then((r) => r.data),

  uploadReceipt: (tenantSlug: string, orderId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api
      .post<{
        url: string;
      }>(`/${tenantSlug}/orders/${orderId}/upload-receipt`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },

  submitPagomovil: (
    tenantSlug: string,
    orderId: string,
    dto: SubmitPagomovilDto,
  ) =>
    api
      .patch(`/${tenantSlug}/orders/${orderId}/pagomovil`, dto)
      .then((r) => r.data),

  getStatus: (tenantSlug: string, orderId: string) =>
    api
      .get<OrderStatusResponse>(`/${tenantSlug}/orders/${orderId}/status`)
      .then((r) => r.data),

  // ── Admin ──────────────────────────────────────────────────────────────
  listPendingVerification: () =>
    api.get<Order[]>("/admin/orders/pending-verification").then((r) => r.data),

  listPendingCash: () =>
    api.get<Order[]>("/admin/orders/pending-cash").then((r) => r.data),

  verifyPagomovil: (orderId: string, dto: VerifyPagomovilDto) =>
    api
      .patch(`/admin/orders/${orderId}/verify-pagomovil`, dto)
      .then((r) => r.data),

  confirmCash: (orderId: string) =>
    api.post(`/admin/orders/${orderId}/confirm-cash`, {}).then((r) => r.data),

  // ── Kitchen / Admin (la transición de estado la usan los dos) ──────────
  listKitchen: () => api.get<Order[]>("/kitchen/orders").then((r) => r.data),

  updateStatus: (orderId: string, dto: UpdateOrderStatusDto) =>
    api.patch(`/kitchen/orders/${orderId}/status`, dto).then((r) => r.data),
};
