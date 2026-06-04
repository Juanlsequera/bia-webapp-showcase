import { useQuery } from "@tanstack/react-query";
import { useTenantSafe, getTenantCapabilities } from "../../lib/tenant";
import { useParams } from "react-router-dom";
import { api } from "../../lib/api";

// ─── Types ────────────────────────────────────────────────────────────────────
interface MetricCard {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}

// ─── Metric cards — usa datos reales del endpoint /analytics/summary ──────────
function useAdaptiveMetrics(stats: any): MetricCard[] {
  if (!stats) return [];

  // /analytics/summary devuelve: totalOrders, totalRevenue, averageTicket, topProduct, periodLabel
  return [
    { label: "Órdenes", value: stats.totalOrders ?? 0 },
    {
      label: "Ingresos (USD)",
      value: `$${(stats.totalRevenue ?? 0).toFixed(2)}`,
    },
    {
      label: "Ticket promedio",
      value: `$${(stats.averageTicket ?? 0).toFixed(2)}`,
    },
    { label: "Producto Top", value: stats.topProduct ?? "—" },
  ];
}

// ─── Recent orders table ──────────────────────────────────────────────────────
function useOrderStatusLabel(
  status: string,
  tenant: ReturnType<typeof useTenantSafe>,
): string {
  const maps: Record<string, Record<string, string>> = {
    food: {
      confirmed: "Confirmado",
      in_kitchen: "En cocina",
      ready: "Listo",
      delivered: "Entregado",
      cancelled: "Cancelado",
      pending_verification: "Verificando",
    },
    retail: {
      confirmed: "Confirmado",
      processing: "Procesando",
      shipped: "Enviado",
      delivered: "Entregado",
      cancelled: "Cancelado",
    },
    booking: {
      confirmed: "Confirmada",
      in_progress: "En curso",
      completed: "Completada",
      cancelled: "Cancelada",
      no_show: "No asistió",
    },
    service: {
      inquiry: "Consulta",
      quoted: "Cotizado",
      approved: "Aprobado",
      in_progress: "En proceso",
      completed: "Completado",
      cancelled: "Cancelado",
    },
  };

  const { primaryArchetype } = getTenantCapabilities(tenant);
  return maps[primaryArchetype]?.[status] ?? status;
}

// ─── AdminDashboardPage ───────────────────────────────────────────────────────
export function AdminDashboardPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const tenant = useTenantSafe();

  const { data: stats } = useQuery({
    queryKey: ["admin-stats", tenantSlug],
    queryFn: async () => (await api.get(`/analytics/summary`)).data,
    refetchInterval: 30_000,
  });

  const { data: orderResponse } = useQuery({
    queryKey: ["admin-orders-recent", tenantSlug],
    queryFn: async () => (await api.get(`/analytics/orders?limit=8`)).data,
    refetchInterval: 15_000,
  });

  const recentOrders = orderResponse?.data ?? [];

  const metrics = useAdaptiveMetrics(stats);

  const caps = getTenantCapabilities(tenant);
  const orderLabel =
    caps.primaryArchetype === "booking"
      ? "Citas recientes"
      : "Órdenes recientes";

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {new Date().toLocaleDateString("es-VE", {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="bg-white rounded-xl p-4 shadow-sm border border-gray-100"
          >
            <p className="text-xs text-gray-500 mb-1">{m.label}</p>
            <p
              className={`text-2xl font-bold ${
                m.color === "warning"
                  ? "text-amber-600"
                  : m.color === "success"
                    ? "text-green-600"
                    : "text-gray-900"
              }`}
            >
              {m.value}
            </p>
            {m.sub && <p className="text-xs text-gray-400 mt-1">{m.sub}</p>}
          </div>
        ))}
      </div>

      {/* Órdenes recientes */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900 text-sm">{orderLabel}</h2>
          <a
            href="ordenes"
            className="text-xs text-gray-400 hover:text-gray-700"
          >
            Ver todas →
          </a>
        </div>
        <div className="divide-y divide-gray-50">
          {recentOrders.length === 0 && (
            <p className="text-center py-8 text-sm text-gray-400">
              No hay órdenes aún
            </p>
          )}
          {recentOrders.map((order: any) => (
            <div
              key={order.orderId}
              className="flex items-center gap-4 px-5 py-3"
            >
              <div>
                <p className="text-xs font-mono text-gray-400">
                  #{order.orderId.slice(-5).toUpperCase()}
                </p>
                <p className="text-sm font-medium text-gray-900">
                  {order.customer_name ??
                    (caps.hasTableQR && order.tableNumber
                      ? `Mesa ${order.tableNumber}`
                      : "Cliente")}
                </p>
              </div>
              <div className="flex-1" />
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                  [
                    "confirmed",
                    "paid",
                    "ready",
                    "completed",
                    "approved",
                  ].includes(order.status)
                    ? "bg-green-50 text-green-700"
                    : ["cancelled", "no_show"].includes(order.status)
                      ? "bg-red-50 text-red-600"
                      : "bg-amber-50 text-amber-700"
                }`}
              >
                {useOrderStatusLabel(order.status, tenant)}
              </span>
              <p className="text-sm font-semibold text-gray-900 w-20 text-right">
                ${(order.total ?? 0).toFixed(2)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
