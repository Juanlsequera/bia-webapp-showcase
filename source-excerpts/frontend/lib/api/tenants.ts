import { api } from "./client";
import type { Tenant, TenantPublic } from "@foodorder/types";

export interface UpdateTenantDto {
  name?: string;
  theme?: { primary: string; secondary: string; accent: string };
  schedule?: {
    openHour: number;
    closeHour: number;
    closedDays: number[];
    timezone: string;
    forceOpen: boolean;
    forceClosed: boolean;
  } | null;
  logoUrl?: string | null;
  logoPublicId?: string | null;
  autoAcceptOrders?: boolean;
  orderModes?: {
    dine_in: boolean;
    takeaway: boolean;
    delivery: boolean;
  };
  // ... cualquier otro campo parcial del tenant
  [key: string]: unknown;
}

export const tenantsApi = {
  /** Endpoint público — usado en el cliente sin auth. */
  getPublic: (tenantSlug: string) =>
    api.get<TenantPublic>(`/tenants/${tenantSlug}/public`).then((r) => r.data),

  /** Tenant del admin logueado. */
  getMe: () => api.get<Tenant>("/tenants/me").then((r) => r.data),

  /** Actualización parcial del tenant (nombre, tema, horario, etc.). */
  updateMe: (dto: UpdateTenantDto) => {
    // Limpiar _id de orderModes si está presente (viene del servidor)
    const cleanDto = { ...dto };
    if (
      cleanDto.orderModes &&
      typeof cleanDto.orderModes === "object" &&
      "_id" in cleanDto.orderModes
    ) {
      const { _id, ...rest } = cleanDto.orderModes as any;
      cleanDto.orderModes = rest as any;
    }
    return api.patch<Tenant>("/tenants/me", cleanDto).then((r) => r.data);
  },

  /** Actualiza la config de upsell "¿Lo hacés combo?". */
  updateUpsell: (dto: {
    enabled?: boolean;
    addOnProductIds?: string[];
    bundleExtraPrice?: number;
  }) => api.patch("/tenants/me/upsell", dto).then((r) => r.data),

  /** Sube el logo del tenant a Cloudinary. */
  uploadLogo: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api
      .post<{ url: string; publicId?: string }>("/tenants/me/upload-logo", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },
};
