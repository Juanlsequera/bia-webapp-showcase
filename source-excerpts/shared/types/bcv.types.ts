// ── Tipo de cambio BCV (Banco Central de Venezuela) ─────────────────────
//
// Los productos del menú se guardan en USD (moneda estable). Al cliente
// final hay que mostrarle el equivalente en Bolívares calculado con la tasa
// oficial BCV del día. El backend cachea la tasa en Redis y la expone en
// el payload público del tenant.

export interface UsdRate {
  /** Bolívares por 1 USD según BCV. Ej: 36.42 */
  value: number;

  /**
   * ISO timestamp de cuando se publicó la tasa según el upstream
   * (no necesariamente cuando la cacheamos). Para `source: 'manual'`
   * es el momento en que el admin la seteó.
   */
  capturedAt: string;

  /**
   * `true` si esta tasa viene del fallback cacheado (last-known) porque
   * el upstream falló. El frontend puede mostrar un warning sutil.
   * `false` para tasas frescas del upstream y para overrides manuales
   * activos.
   */
  stale: boolean;

  /**
   * Fuente de la tasa:
   *   - `bcv`: upstream oficial (https://ve.dolarapi.com o configurado)
   *   - `manual`: override seteado por admin (B1) cuando el upstream falla
   *   - `fallback`: hardcoded de emergencia (upstream + Redis caídos)
   */
  source: "bcv" | "manual" | "fallback";

  /**
   * `true` cuando la tasa fue fijada manualmente por un admin via
   * POST /admin/bcv-rate/override. Útil para que el frontend pinte un
   * indicador "tasa manual" y para auditoría.
   */
  manual_override?: boolean;

  /** Email del admin que seteó el override (solo cuando manual_override=true). */
  set_by?: string;
}

/** DTO para overrides manuales — usado en POST /admin/bcv-rate/override */
export interface OverrideBcvRateDto {
  /** Valor en Bolívares por 1 USD. Entre 1 y 10000. */
  rate: number;
  /** Cuánto tiempo dura este override antes de volver al upstream. Entre 1 y 168 (1 semana). */
  ttl_hours: number;
  /** Motivo del override (opcional, queda en logs para auditoría). */
  reason?: string;
}

// ── Tasas multi-divisa ──────────────────────────────────────────────────
//
// Más allá de la tasa BCV histórica (UsdRate), el admin necesita ver el
// mercado completo: USD oficial, USD paralelo, EUR oficial, USDT (cripto).
// Cada tasa se cachea por separado en Redis con el mismo patrón de fallback.

/** Identificador estable de una tasa de cambio. */
export type RateCode = "USD_BCV" | "EUR_BCV" | "EUR_PARALELO" | "USDT";

export interface MarketRate {
  /** Identificador estable (USD_BCV, EUR_BCV, USDT, …) */
  code: RateCode;
  /** Nombre humano para la UI (ej: "USD oficial (BCV)") */
  label: string;
  /** Símbolo de la moneda (`$`, `€`, `₮`) */
  symbol: string;
  /** Código ISO-4217 cuando aplica (USD/EUR), o `USDT` */
  currency: "USD" | "EUR" | "USDT";
  /** Bolívares por 1 unidad de la moneda (ej: 100 → 1 USD = 100 Bs) */
  value: number;
  /** ISO timestamp publicado por el upstream */
  capturedAt: string;
  /** `true` si viene del cache last-known (upstream caído) o del hard-fallback */
  stale: boolean;
  /** Fuente: `upstream` (fresh) | `cache` (last-known) | `fallback` (hardcoded) */
  source: "upstream" | "cache" | "fallback";
}

export interface RatesSnapshot {
  rates: MarketRate[];
  /** Cuándo se consolidó esta respuesta del servidor. */
  fetchedAt: string;
}

/**
 * Snapshot de pricing capturado al crear una orden. Una vez creada, no se
 * recalcula aunque la tasa cambie — el cliente paga el `total_bs` con el
 * que se mostró el carrito.
 */
export interface OrderPricing {
  /** Total en USD (suma de items.unitPrice × quantity) */
  total_usd: number;

  /** Tasa BCV usada para convertir, en el momento de crear la orden */
  usd_rate: number;

  /** Cuándo publicó BCV esa tasa */
  rate_captured_at: Date | string;

  /** Total en Bolívares = round(total_usd × usd_rate, 2) */
  total_bs: number;

  /** `true` si la tasa venía del fallback (BCV API estaba caída) */
  rate_stale: boolean;
}
