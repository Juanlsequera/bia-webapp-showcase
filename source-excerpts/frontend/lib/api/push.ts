import { api } from "./client";

export interface PushSubscriptionDto {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const pushApi = {
  /** Suscribe el browser del cliente a notificaciones push de su pedido. */
  subscribe: (tenantSlug: string, orderId: string, dto: PushSubscriptionDto) =>
    api
      .post(`/${tenantSlug}/orders/${orderId}/subscribe-push`, dto)
      .then((r) => r.data),
};
