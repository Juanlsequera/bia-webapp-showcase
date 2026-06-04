import { RatesSnapshot } from "@foodorder/types";
import { api } from "./client";

/**
 * Helper API para tasas multi-divisa.
 *
 * - `getAll()` → público, snapshot con USD-BCV, USD paralelo, EUR-BCV, USDT.
 * - `refresh()` → admin/superadmin, fuerza refresh saltando cache.
 */
export const ratesApi = {
  getAll: (): Promise<RatesSnapshot> =>
    api.get<RatesSnapshot>("/rates").then((r) => r.data),

  refresh: (): Promise<RatesSnapshot> =>
    api.post<RatesSnapshot>("/admin/rates/refresh").then((r) => r.data),
};
