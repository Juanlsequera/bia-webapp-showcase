import { api } from "./client";

export type TenantConfig = Record<string, unknown>;

export const tenantConfigApi = {
  /** Obtiene la config efectiva del tenant autenticado (admin). */
  getMine: (): Promise<TenantConfig> =>
    api.get("/tenants/me/config").then((r) => r.data as TenantConfig),

  /** Aplica un patch parcial. Retorna la config resultante. */
  update: (patch: TenantConfig): Promise<TenantConfig> =>
    api.patch("/tenants/me/config", patch).then((r) => r.data as TenantConfig),

  /** Config sanitizada para el storefront público (sin auth). */
  getPublic: (slug: string): Promise<TenantConfig> =>
    api
      .get(`/tenants/${slug}/public-config`)
      .then((r) => r.data as TenantConfig),
};
