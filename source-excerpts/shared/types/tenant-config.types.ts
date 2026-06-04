// ─── TenantConfig types ───────────────────────────────────────────────────────

export interface TenantConfigSnapshot {
  _id: string;
  tenant_id: string;
  version: number;
  is_active: boolean;
  label: string | null;
  changed_by: string | null;
  theme: import("./tenant.types").ThemeColors;
  modules: import("./tenant.types").TenantModules;
  payment_methods: import("./tenant.types").TenantPaymentMethods;
  checkout_fields: import("./tenant.types").TenantCheckoutFields;
  business_types: import("./tenant.types").BusinessType[];
  config_hash: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Campos nuevos en Tenant para tracking de config ─────────────────────────
// Agregar estos campos a la interfaz Tenant existente en tenant.types.ts:

export interface TenantConfigTracking {
  /**
   * Número de versión de la config activa (empieza en 1, +1 con cada cambio).
   * Útil para detectar si el cliente tiene la config desactualizada.
   */
  config_version: number;

  /**
   * Hash MD5 (12 chars) de la config activa.
   * Incluido en TenantPublic para que el frontend lo use como cache key.
   * Ejemplo de uso en frontend:
   *   applyTenantTheme(tenant.theme); // solo si hash cambió vs localStorage
   *   localStorage.setItem(`theme_${tenant.slug}`, tenant.config_hash);
   */
  config_hash: string;

  /**
   * Referencia a la config activa en la colección tenant_configs.
   * null si aún no se migró al sistema de configs.
   */
  active_config_id: string | null;
}

// ─── DTO para crear una nueva versión de config ────────────────────────────────
export interface CreateConfigVersionDto {
  label?: string;
  theme?: import("./tenant.types").ThemeColors;
  modules?: Partial<import("./tenant.types").TenantModules>;
  payment_methods?: Partial<import("./tenant.types").TenantPaymentMethods>;
  checkout_fields?: Partial<import("./tenant.types").TenantCheckoutFields>;
  business_types?: import("./tenant.types").BusinessType[];
}

// ─── DTO para restaurar una versión anterior ──────────────────────────────────
export interface RestoreConfigVersionDto {
  config_id: string;
}
