import { api, downloadCsv } from "./client";

export interface PaymentsFilter {
  dateFrom: string;
  dateTo: string;
  page?: number;
  limit?: number;
  status?: string;
  method?: string;
}

export interface SaveArqueoDto {
  date: string;
  efectivo_fisico?: number | null;
  debito_fisico?: number | null;
  notas?: string | null;
}

function paymentsFilterToQuery(f: PaymentsFilter): string {
  const params = new URLSearchParams({
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    page: String(f.page ?? 1),
    limit: String(f.limit ?? 50),
  });
  if (f.status) params.set("status", f.status);
  if (f.method) params.set("method", f.method);
  return params.toString();
}

export const paymentsApi = {
  transactions: <T = unknown>(filter: PaymentsFilter) =>
    api
      .get<T>(`/admin/payments/transactions?${paymentsFilterToQuery(filter)}`)
      .then((r) => r.data),

  /** Devuelve null si todavía no se hizo el arqueo de ese día. */
  getArqueo: <T = unknown>(date: string) =>
    api
      .get<T>(`/admin/payments/arqueo/${date}`)
      .then((r) => r.data)
      .catch(() => null),

  saveArqueo: (dto: SaveArqueoDto) =>
    api.post("/admin/payments/arqueo", dto).then((r) => r.data),

  /** Cierra formalmente la caja del día. Devuelve el arqueo actualizado. */
  closeArqueo: <T = unknown>(date: string) =>
    api.post<T>("/admin/payments/arqueo/close", { date }).then((r) => r.data),

  exportCsv: (filter: PaymentsFilter, filename: string) =>
    downloadCsv(
      `/admin/payments/export.csv?${paymentsFilterToQuery(filter)}`,
      filename,
    ),
};
