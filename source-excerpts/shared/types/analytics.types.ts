export interface AnalyticsFilter {
  dateFrom?: string;
  dateTo?: string;
  productId?: string;
  status?: string;
  tableNumber?: number;
  page?: number;
  limit?: number;
}
export interface SummaryMetrics {
  totalOrders: number;
  totalRevenue: number;
  averageTicket: number;
  topProduct: string | null;
  periodLabel: string;
}
export interface ProductMetric {
  productId: string;
  productName: string;
  totalQuantity: number;
  totalRevenue: number;
}
export interface RevenueByDay {
  date: string; // YYYY-MM-DD
  revenue: number;
  orders: number;
}
export interface OrderRow {
  orderId: string;
  orderType: string;
  tableNumber: number | null;
  pickup_code: string | null;
  customer_name: string | null;
  total: number;
  status: string;
  paymentMethod: string;
  itemCount: number;
  createdAt: string;
}
export interface GlobalMetrics {
  totalTenants: number;
  activeTenants: number;
  totalOrders: number;
  totalRevenue: number;
  averageTicket: number;
  topTenant: string | null;
}
export interface TenantAnalyticsSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  totalOrders: number;
  totalRevenue: number;
  averageTicket: number;
  lastOrderAt: string | null;
}

export interface PaymentMethodMetric {
  method: string;
  totalOrders: number;
  totalRevenue: number;
}

export interface HourlyMetric {
  hour: number; // 0-23 UTC
  totalOrders: number;
  totalRevenue: number;
}

/**
 * Métricas operativas de cocina (food).
 *
 * Threshold de "crítico": pedido con tiempo paid→ready > CRITICAL_THRESHOLD_MIN.
 * El backend define el threshold; lo devuelve junto con la métrica para que el
 * frontend pinte la card del color correcto.
 *
 * `totalMeasurable` indica cuántas órdenes del rango tienen los timestamps
 * necesarios para el cálculo. Si totalMeasurable === 0, los tiempos vienen
 * null y el frontend debe mostrar "Sin datos aún" en vez de 0 minutos.
 */
export interface KitchenTimesMetric {
  /** Tiempo promedio de cocina (preparing → ready), en minutos. */
  avgPreparingMinutes: number | null;
  /** Tiempo promedio de entrega (ready → delivered), en minutos. */
  avgDeliveryMinutes: number | null;
  /** Tiempo total promedio (paid → delivered), en minutos. */
  avgTotalMinutes: number | null;
  /** Cantidad de pedidos críticos (preparing→ready > criticalThresholdMin). */
  criticalOrders: number;
  /** Porcentaje sobre los pedidos medibles. */
  criticalRate: number;
  /** Cantidad de órdenes canceladas en el rango. */
  cancelledOrders: number;
  /** Porcentaje sobre el total del rango (incluye approved + cancelled). */
  cancellationRate: number;
  /** Cuántas órdenes del rango tienen los timestamps suficientes para medir. */
  totalMeasurable: number;
  /** Total de órdenes en el rango (cualquier estado, incluye cancelled). */
  totalOrders: number;
  /** Threshold en minutos para considerar un pedido "crítico". */
  criticalThresholdMin: number;
}

export interface TenantLeaderboardEntry {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  totalOrders: number;
  totalRevenue: number;
  averageTicket: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
