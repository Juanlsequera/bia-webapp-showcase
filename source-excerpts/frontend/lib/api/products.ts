import { api } from "./client";
import type { Product, MenuResponse } from "@foodorder/types";

export interface ProductDto {
  name: string;
  description: string;
  price: number;
  category: string;
  image_url?: string | null;
  image_public_id?: string | null;
  stockQuantity?: number | null;
}

export const productsApi = {
  /** Admin — lista completa con productos activos e inactivos. */
  list: () => api.get<Product[]>("/admin/products").then((r) => r.data),

  create: (dto: ProductDto) =>
    api.post<Product>("/admin/products", dto).then((r) => r.data),

  update: (id: string, dto: ProductDto) =>
    api.put<Product>(`/admin/products/${id}`, dto).then((r) => r.data),

  /** Toggle activo/inactivo. */
  toggle: (id: string) =>
    api.patch<Product>(`/admin/products/${id}/toggle`).then((r) => r.data),

  remove: (id: string) =>
    api.delete(`/admin/products/${id}`).then((r) => r.data),

  /** Sube imagen del producto a Cloudinary. Devuelve { url, publicId }. */
  uploadImage: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return api
      .post<{ url: string; publicId?: string }>(
        "/admin/products/upload-image",
        fd,
        {
          headers: { "Content-Type": "multipart/form-data" },
        },
      )
      .then((r) => r.data);
  },
};

/** Endpoint público del menú — usado por el cliente sin auth. */
export const menuApi = {
  get: (tenantSlug: string) =>
    api.get<MenuResponse>(`/${tenantSlug}/menu`).then((r) => r.data),
};
