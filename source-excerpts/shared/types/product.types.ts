// ─── Disponibilidad programada ────────────────────────────────────────────────

/**
 * Ventana de disponibilidad de un producto o combo.
 * Persistida tal cual en el documento; NO incluye `available` ni `label`
 * (esos se calculan por-request en MenuService para no congelar el cache).
 */
export interface ProductAvailability {
  mode: "always" | "scheduled";
  startDate: string | null; // ISO date string o null
  endDate: string | null;
  daysOfWeek: number[]; // 0=Dom … 6=Sáb. [] = todos los días
  timeStart: string | null; // "17:00"
  timeEnd: string | null; // "20:00"
  whenUnavailable: "hide" | "show_disabled";
}

/**
 * Resultado de evaluar la disponibilidad de un producto en un momento dado.
 * Calculado por-request; nunca cacheado.
 */
export interface AvailabilityResult {
  available: boolean;
  reason: "date" | "day" | "time" | null;
  /** Etiqueta legible para el cliente, ej: "Disponible hoy 17:00–20:00" */
  label: string;
}

// ─── Product Type ─────────────────────────────────────────────────────────────
/**
 * physical  → producto físico (retail): ropa, botellones, repuestos
 * prepared  → comida preparada (food): hamburguesas, platos, jugos
 * service   → servicio con agenda (booking): cortes, masajes, asesorías
 * labor     → trabajo técnico con cotización (service): reparación, instalación
 */
export type ProductType = "physical" | "prepared" | "service" | "labor";

// ─── Variants (retail) ────────────────────────────────────────────────────────
export interface ProductVariantOption {
  name: string; // ej: 'Talla'
  values: string[]; // ej: ['S','M','L','XL']
}

export interface ProductVariant {
  _id: string;
  name: string; // ej: 'Azul / M'
  options: Record<string, string>; // { color: 'Azul', talla: 'M' }
  price_override?: number | null; // null = usa el precio base
  stock_qty?: number;
  sku?: string | null;
}

// ─── Modifiers (food extras) ──────────────────────────────────────────────────
export interface ModifierOption {
  name: string; // ej: 'Sin cebolla'
  price_extra: number; // 0 si no tiene costo adicional
}

export interface ProductModifier {
  _id: string;
  name: string; // ej: 'Extras'
  type: "single" | "multiple"; // radio vs checkbox
  required: boolean;
  options: ModifierOption[];
}

// ─── Product (documento completo) ────────────────────────────────────────────
export interface Product {
  _id: string;
  tenantId: string;
  name: string;
  description: string;
  price: number;
  compare_price?: number | null; // precio tachado (antes era X)
  image_url: string | null;
  category: string;
  type: ProductType;
  active: boolean;
  // Stock — retail y food parcialmente
  stock_enabled: boolean;
  stock_qty: number;
  /** @deprecated usar stock_qty */
  stockQuantity?: number | null;
  // Food
  prep_time_minutes?: number | null;
  modifiers?: ProductModifier[];
  // Booking / Service
  duration_minutes?: number | null;
  // Retail
  variants_enabled: boolean;
  variants?: ProductVariant[];
  createdAt: Date;
  updatedAt: Date;
}

// ─── PublicProduct (lo que ve el cliente) ─────────────────────────────────────
export interface PublicProduct {
  _id: string;
  name: string;
  description: string;
  price: number;
  compare_price?: number | null;
  image_url: string | null;
  category: string;
  type: ProductType;
  stock_enabled: boolean;
  stock_qty: number;
  prep_time_minutes?: number | null;
  duration_minutes?: number | null;
  variants_enabled: boolean;
  variants?: ProductVariant[];
  modifiers?: ProductModifier[];
  /** Configuración raw de disponibilidad (se envía al cliente para re-evaluar en vivo — Fase 2). */
  availability?: ProductAvailability;
  /** ¿Está disponible ahora mismo? Calculado por-request en MenuService. */
  available?: boolean;
  /** Etiqueta legible de disponibilidad, ej: "Hoy 17:00–20:00". */
  availabilityLabel?: string;
}

// ─── Upsell resuelto (incluido en CatalogResponse) ───────────────────────────
export interface ResolvedUpsell {
  enabled: boolean;
  /** Productos add-on ya resueltos (activos, del tenant). */
  addOns: PublicProduct[];
  bundleExtraPrice: number;
}

// ─── Catalog Response ─────────────────────────────────────────────────────────
export interface CatalogResponse {
  categories: Array<{
    category: string;
    items: PublicProduct[];
  }>;
  /** Upsell "¿Lo hacés combo?" — solo presente si enabled=true. */
  upsell?: ResolvedUpsell;
}

/** @deprecated use CatalogResponse */
export type MenuResponse = CatalogResponse;

// ─── DTOs ─────────────────────────────────────────────────────────────────────
export interface CreateProductDto {
  name: string;
  description?: string;
  price: number;
  compare_price?: number | null;
  category: string;
  type?: ProductType;
  image_url?: string | null;
  stock_enabled?: boolean;
  stock_qty?: number;
  prep_time_minutes?: number | null;
  duration_minutes?: number | null;
  variants_enabled?: boolean;
}

export type ProductSortField = "name" | "price" | "createdAt" | "stock_qty";
