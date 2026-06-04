import { api, downloadCsv } from "./client";
import type { KitchenTimesMetric } from "@foodorder/types";

export interface AnalyticsDateRange {
  dateFrom: string;
  dateTo: string;
}

export interface AnalyticsOrdersFilter extends AnalyticsDateRange {
  page?: number;
  limit?: number;
  status?: string;
  paymentMethod?: string;
  tableNumber?: string;
  orderType?: string;
}

export interface DailySummary {
  totalOrders: number;
  totalRevenue: number;
  averageTicket: number;
  topProduct?: string | null;
}

export interface TopProduct {
  productId: string;
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
}

export interface RevenueByDay {
  date: string;
  revenue: number;
}

export interface PaymentMethodMetric {
  method: string;
  totalOrders: number;
  totalRevenue: number;
}

export interface HourlyMetric {
  hour: number;
  totalOrders: number;
  totalRevenue: number;
}

function rangeToQuery({ dateFrom, dateTo }: AnalyticsDateRange): string {
  return `dateFrom=${dateFrom}&dateTo=${dateTo}`;
}

function ordersFilterToQuery(f: AnalyticsOrdersFilter): string {
  const params = new URLSearchParams({
    dateFrom: f.dateFrom,
    dateTo: f.dateTo,
    page: String(f.page ?? 1),
    limit: String(f.limit ?? 50),
  });
  if (f.status) params.set("status", f.status);
  if (f.paymentMethod) params.set("paymentMethod", f.paymentMethod);
  if (f.tableNumber) params.set("tableNumber", f.tableNumber);
  if (f.orderType) params.set("orderType", f.orderType);
  return params.toString();
}

export const analyticsApi = {
  summary: (range: AnalyticsDateRange) =>
    api
      .get<DailySummary>(`/analytics/summary?${rangeToQuery(range)}`)
      .then((r) => r.data),

  topProducts: (range: AnalyticsDateRange) =>
    api
      .get<TopProduct[]>(`/analytics/products?${rangeToQuery(range)}`)
      .then((r) => r.data),

  revenueByDay: (range: AnalyticsDateRange) =>
    api
      .get<RevenueByDay[]>(`/analytics/revenue-by-day?${rangeToQuery(range)}`)
      .then((r) => r.data),

  orders: <T = unknown>(filter: AnalyticsOrdersFilter) =>
    api
      .get<T>(`/analytics/orders?${ordersFilterToQuery(filter)}`)
      .then((r) => r.data),

  paymentMethods: (range: AnalyticsDateRange) =>
    api
      .get<
        PaymentMethodMetric[]
      >(`/analytics/payment-methods?${rangeToQuery(range)}`)
      .then((r) => r.data),

  byHour: (range: AnalyticsDateRange) =>
    api
      .get<HourlyMetric[]>(`/analytics/by-hour?${rangeToQuery(range)}`)
      .then((r) => r.data),

  /** Tiempos operativos de cocina (food). Devuelve null en los promedios si
   *  no hay órdenes con timestamps suficientes para medir. */
  kitchenTimes: (range: AnalyticsDateRange) =>
    api
      .get<KitchenTimesMetric>(
        `/analytics/kitchen-times?${rangeToQuery(range)}`,
      )
      .then((r) => r.data),

  bookingStats: (range: AnalyticsDateRange) =>
    api
      .get<{
        total: number;
        completed: number;
        cancelled: number;
        noShow: number;
        active: number;
        completionRate: number;
        cancellationRate: number;
        noShowRate: number;
      }>(`/analytics/booking-stats?${rangeToQuery(range)}`)
      .then((r) => r.data),

  serviceStats: (range: AnalyticsDateRange) =>
    api
      .get<{
        total: number;
        byStatus: Record<string, number>;
        conversionRate: number;
        closeRate: number;
        avgRevenuePerJob: number;
      }>(`/analytics/service-stats?${rangeToQuery(range)}`)
      .then((r) => r.data),

  /** Descarga el CSV del rango/filtro con el JWT actual. */
  exportCsv: (filter: AnalyticsOrdersFilter, filename: string) =>
    downloadCsv(
      `/analytics/export.csv?${ordersFilterToQuery(filter)}`,
      filename,
    ),
};
