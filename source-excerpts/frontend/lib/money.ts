/**
 * Helpers de formateo USD↔Bs para mostrar precios al cliente final.
 *
 * Convención del proyecto:
 *  - Los productos del catálogo y los totales internos están en USD.
 *  - El cliente paga en Bs según la tasa BCV vigente al momento de crear
 *    la orden (ver BcvRateService + OrderPricing en el back).
 *  - Cualquier UI que muestre precios al cliente debe priorizar USD y poner
 *    el equivalente en Bs como secundario.
 */

const USD_FORMAT = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Locale 'es-VE' formatea con punto de miles y coma decimal: "1.234,56".
const BS_FORMAT = new Intl.NumberFormat("es-VE", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** "$8.50" — lo que vende el catálogo. */
export function formatUsd(amountUsd: number): string {
  return `$${USD_FORMAT.format(amountUsd)}`;
}

/** "Bs. 309,57" — equivalente a la tasa BCV del momento. */
export function formatBs(amountBs: number): string {
  return `Bs. ${BS_FORMAT.format(amountBs)}`;
}

/** Convierte USD→Bs y redondea a 2 decimales (mismo cálculo que el back). */
export function usdToBs(amountUsd: number, usdRate: number): number {
  return Math.round(amountUsd * usdRate * 100) / 100;
}

/**
 * Texto secundario que va debajo del precio en USD.
 * Ej: `≈ Bs. 309,57`. Se usa "≈" para dejar claro que la tasa es referencial.
 */
export function formatBsApprox(amountUsd: number, usdRate: number): string {
  return `≈ ${formatBs(usdToBs(amountUsd, usdRate))}`;
}
