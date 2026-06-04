import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Package,
  ShoppingBag,
  TrendingUp,
  Clock,
  CreditCard,
  ChefHat,
  AlertTriangle,
  X as XIcon,
  Timer,
  Calendar,
  CheckCircle,
  UserX,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { analyticsApi } from "../../lib/api";
import { Button, Skeleton, EmptyState } from "../../components/ui";
import { useAuthStore } from "../../stores/auth.store";
import { useTenantPlan } from "../../hooks/useTenantPlan";
import { useTenantConfig } from "../../hooks/useTenantConfig";
import { UpgradeCard } from "../../components/admin/UpgradeCard";
import { formatUsd } from "../../lib/money";
import { useTour } from "../../hooks/use-tour";
import { TourTrigger } from "../../components/tour/TourTrigger";
import { adminAnalyticsSteps } from "../../lib/tours/admin-analytics.tour";

// ── Preset helpers ────────────────────────────────────────────────────────────

function fmtDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

const PRESETS = [
  {
    label: "Hoy",
    range: () => {
      const t = fmtDate(new Date());
      return { from: t, to: t };
    },
  },
  {
    label: "Ayer",
    range: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const t = fmtDate(d);
      return { from: t, to: t };
    },
  },
  {
    label: "7 días",
    range: () => {
      const d = new Date();
      const to = fmtDate(d);
      d.setDate(d.getDate() - 6);
      return { from: fmtDate(d), to };
    },
  },
  {
    label: "30 días",
    range: () => {
      const d = new Date();
      const to = fmtDate(d);
      d.setDate(d.getDate() - 29);
      return { from: fmtDate(d), to };
    },
  },
  {
    label: "Este mes",
    range: () => {
      const d = new Date();
      const to = fmtDate(d);
      return {
        from: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`,
        to,
      };
    },
  },
];

const METHOD_LABEL: Record<string, string> = {
  pagomovil: "PagoMóvil",
  cash: "Efectivo",
  debit_card: "Débito",
  stripe: "Stripe",
  mercadopago: "MercadoPago",
};

// VET offset = UTC-4, so hour_VET = hour_UTC - 4 (mod 24)
function utcHourToVet(h: number) {
  return (h - 4 + 24) % 24;
}
function fmtHour(h: number) {
  const ampm = h >= 12 ? "pm" : "am";
  const h12 = h % 12 || 12;
  return `${h12}${ampm}`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function AdminAnalyticsPage() {
  const { user } = useAuthStore();
  const { isPro } = useTenantPlan();
  const { config: tenantConfig } = useTenantConfig();

  // Detectar archetype; fallback 'food' si todavía no cargó
  const archetype: string =
    (tenantConfig as any)?.business_types?.[0] ?? "food";
  const isFood = archetype === "food";
  const isBooking = archetype === "booking";

  // Default: últimos 30 días
  const initRange = PRESETS[3].range();
  const [dateFrom, setDateFrom] = useState(initRange.from);
  const [dateTo, setDateTo] = useState(initRange.to);
  const [activePreset, setActivePreset] = useState<string>("30 días");

  const range = { dateFrom, dateTo };

  const queryConfig = {
    refetchOnWindowFocus: false,
    enabled: !!user?.tenantId,
  } as const;

  const { data: summary, isLoading: loadingSummary } = useQuery({
    queryKey: ["analytics-summary", dateFrom, dateTo],
    queryFn: () => analyticsApi.summary(range),
    ...queryConfig,
  });

  const { data: topProducts = [], isLoading: loadingProducts } = useQuery({
    queryKey: ["analytics-top-products", dateFrom, dateTo],
    queryFn: () => analyticsApi.topProducts(range),
    ...queryConfig,
  });

  const { data: revenueByDay = [], isLoading: loadingRevenue } = useQuery({
    queryKey: ["analytics-revenue-day", dateFrom, dateTo],
    queryFn: () => analyticsApi.revenueByDay(range),
    ...queryConfig,
  });

  const { data: paymentMethods = [], isLoading: loadingPM } = useQuery({
    queryKey: ["analytics-payment-methods", dateFrom, dateTo],
    queryFn: () => analyticsApi.paymentMethods(range),
    ...queryConfig,
  });

  const { data: byHour = [], isLoading: loadingHour } = useQuery({
    queryKey: ["analytics-by-hour", dateFrom, dateTo],
    queryFn: () => analyticsApi.byHour(range),
    ...queryConfig,
    enabled: !!user?.tenantId && isPro,
  });

  // Operación de cocina (food). Solo cuenta órdenes con archetype=food.
  // `totalMeasurable === 0` significa que no hay órdenes con timestamps todavía
  // (ej. todas viejas, anteriores al rollout de tracking).
  const { data: kitchen, isLoading: loadingKitchen } = useQuery({
    queryKey: ["analytics-kitchen-times", dateFrom, dateTo],
    queryFn: () => analyticsApi.kitchenTimes(range),
    ...queryConfig,
    enabled: !!user?.tenantId && isPro,
  });

  // Booking stats (booking archetype only)
  const { data: bookingStats, isLoading: loadingBookingStats } = useQuery({
    queryKey: ["analytics-booking-stats", dateFrom, dateTo],
    queryFn: () => analyticsApi.bookingStats(range),
    ...queryConfig,
    enabled: !!user?.tenantId && archetype === "booking",
  });

  // Service stats (service archetype only)
  const { data: serviceStats, isLoading: loadingServiceStats } = useQuery({
    queryKey: ["analytics-service-stats", dateFrom, dateTo],
    queryFn: () => analyticsApi.serviceStats(range),
    ...queryConfig,
    enabled: !!user?.tenantId && archetype === "service",
  });

  // Order type split (dine_in vs takeaway)
  const { data: dineInData } = useQuery<{ total: number }>({
    queryKey: ["analytics-dine-in", dateFrom, dateTo],
    queryFn: () =>
      analyticsApi.orders({
        ...range,
        orderType: "dine_in",
        limit: 1,
        page: 1,
      }),
    ...queryConfig,
  });
  const { data: takeawayData } = useQuery<{ total: number }>({
    queryKey: ["analytics-takeaway", dateFrom, dateTo],
    queryFn: () =>
      analyticsApi.orders({
        ...range,
        orderType: "takeaway",
        limit: 1,
        page: 1,
      }),
    ...queryConfig,
  });

  const handleExport = () =>
    analyticsApi.exportCsv(range, `reporte-${dateFrom}-${dateTo}.csv`);

  const applyPreset = useCallback((p: (typeof PRESETS)[0]) => {
    const r = p.range();
    setDateFrom(r.from);
    setDateTo(r.to);
    setActivePreset(p.label);
  }, []);

  // Hourly data — convert UTC to VET and fill all 24h
  const hourlyVet = (() => {
    const map = new Map(byHour.map((h) => [utcHourToVet(h.hour), h]));
    return Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      label: fmtHour(i),
      totalOrders: map.get(i)?.totalOrders ?? 0,
    }));
  })();

  // Payment method total for % calculation
  const pmTotal = paymentMethods.reduce((s, m) => s + m.totalOrders, 0);

  // Order type
  const dineIn = dineInData?.total ?? 0;
  const takeaway = takeawayData?.total ?? 0;
  const orderTypeTotal = dineIn + takeaway || 1;

  const { start: startTour } = useTour("admin-analytics", adminAnalyticsSteps);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <TourTrigger onStart={startTour} />

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-app-text">Analytics</h1>
          <p className="text-sm text-muted">
            {(summary as any)?.periodLabel ?? `${dateFrom} → ${dateTo}`}
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={handleExport}>
          <Download size={15} className="mr-1.5" />
          Exportar CSV
        </Button>
      </div>

      {/* ── Filtros de fecha ── */}
      <div
        data-tour="analytics-date-range"
        className="bg-surface border border-border rounded-2xl p-4 space-y-3"
      >
        {/* Presets */}
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activePreset === p.label
                  ? "bg-primary text-white"
                  : "bg-bg border border-border text-muted hover:text-app-text hover:border-primary/40"
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {/* Custom range */}
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-xs text-muted block mb-1">Desde</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setActivePreset("");
              }}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
            />
          </div>
          <div className="flex-1">
            <label className="text-xs text-muted block mb-1">Hasta</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setActivePreset("");
              }}
              className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      </div>

      {/* ── Booking stats ── */}
      {archetype === "booking" && (
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h2 className="font-semibold text-app-text mb-4 text-sm flex items-center gap-2">
            <Calendar size={15} className="text-muted" />
            Resumen de reservas
          </h2>
          {loadingBookingStats ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-bg border border-border rounded-xl p-3 space-y-2"
                >
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>
          ) : !bookingStats || bookingStats.total === 0 ? (
            <p className="text-sm text-muted text-center py-4">
              Sin reservas en este período
            </p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <KitchenCard
                icon={<Calendar size={14} />}
                label="Total reservas"
                valueLabel={String(bookingStats.total)}
                tone="neutral"
                hint="en el período"
              />
              <KitchenCard
                icon={<CheckCircle size={14} />}
                label="Completadas"
                valueLabel={`${bookingStats.completed} (${bookingStats.completionRate}%)`}
                tone={
                  bookingStats.completionRate >= 70
                    ? "good"
                    : bookingStats.completionRate >= 50
                      ? "warn"
                      : "bad"
                }
                hint={`${bookingStats.active} activas`}
              />
              <KitchenCard
                icon={<XIcon size={14} />}
                label="Canceladas"
                valueLabel={`${bookingStats.cancelled} (${bookingStats.cancellationRate}%)`}
                tone={
                  bookingStats.cancellationRate <= 5
                    ? "good"
                    : bookingStats.cancellationRate <= 15
                      ? "warn"
                      : "bad"
                }
                hint="por el admin o cliente"
              />
              <KitchenCard
                icon={<UserX size={14} />}
                label="No se presentó"
                valueLabel={`${bookingStats.noShow} (${bookingStats.noShowRate}%)`}
                tone={
                  bookingStats.noShowRate <= 5
                    ? "good"
                    : bookingStats.noShowRate <= 15
                      ? "warn"
                      : "bad"
                }
                hint="no-show registrado"
              />
            </div>
          )}
        </div>
      )}

      {/* ── Stats servicio técnico ── */}
      {archetype === "service" && (
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h2 className="font-semibold text-app-text mb-4 text-sm flex items-center gap-2">
            <CheckCircle size={15} className="text-muted" />
            Resumen de trabajos
          </h2>
          {loadingServiceStats ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="bg-bg border border-border rounded-xl p-3 space-y-2"
                >
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
              ))}
            </div>
          ) : !serviceStats || serviceStats.total === 0 ? (
            <p className="text-sm text-muted text-center py-4">
              Sin trabajos en este período
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                <KitchenCard
                  icon={<ShoppingBag size={14} />}
                  label="Total trabajos"
                  valueLabel={String(serviceStats.total)}
                  tone="neutral"
                  hint="en el período"
                />
                <KitchenCard
                  icon={<CheckCircle size={14} />}
                  label="Completados"
                  valueLabel={`${serviceStats.byStatus["completed"] ?? 0} (${serviceStats.conversionRate}%)`}
                  tone={
                    serviceStats.conversionRate >= 50
                      ? "good"
                      : serviceStats.conversionRate >= 25
                        ? "warn"
                        : "bad"
                  }
                  hint="tasa de cierre"
                />
                <KitchenCard
                  icon={<TrendingUp size={14} />}
                  label="Aprobados / en curso"
                  valueLabel={`${serviceStats.closeRate}%`}
                  tone={
                    serviceStats.closeRate >= 60
                      ? "good"
                      : serviceStats.closeRate >= 30
                        ? "warn"
                        : "bad"
                  }
                  hint="aprobados + en curso + completados"
                />
                <KitchenCard
                  icon={<CreditCard size={14} />}
                  label="Ticket promedio"
                  valueLabel={
                    serviceStats.avgRevenuePerJob > 0
                      ? formatUsd(serviceStats.avgRevenuePerJob)
                      : "—"
                  }
                  tone="neutral"
                  hint="trabajos completados"
                />
              </div>
              {/* Breakdown por estado */}
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    {
                      key: "inquiry",
                      label: "Consulta",
                      color: "bg-gray-100 text-gray-600",
                    },
                    {
                      key: "quoted",
                      label: "Cotizado",
                      color: "bg-amber-100 text-amber-700",
                    },
                    {
                      key: "approved",
                      label: "Aprobado",
                      color: "bg-blue-100 text-blue-700",
                    },
                    {
                      key: "in_progress",
                      label: "En curso",
                      color: "bg-indigo-100 text-indigo-700",
                    },
                    {
                      key: "completed",
                      label: "Completado",
                      color: "bg-emerald-100 text-emerald-700",
                    },
                    {
                      key: "rejected",
                      label: "Rechazado",
                      color: "bg-red-100 text-red-600",
                    },
                    {
                      key: "cancelled",
                      label: "Cancelado",
                      color: "bg-gray-100 text-gray-500",
                    },
                  ] as const
                )
                  .filter((s) => (serviceStats.byStatus[s.key] ?? 0) > 0)
                  .map((s) => (
                    <span
                      key={s.key}
                      className={`text-xs font-semibold px-2.5 py-1 rounded-full ${s.color}`}
                    >
                      {s.label}: {serviceStats.byStatus[s.key]}
                    </span>
                  ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Banner retail (próximamente, service ya tiene panel real) ── */}
      {archetype === "retail" && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-4 flex gap-3 items-start">
          <span className="text-xl flex-shrink-0">📊</span>
          <div>
            <p className="text-sm font-semibold text-indigo-800">
              Analytics Retail — próximamente
            </p>
            <p className="text-xs text-indigo-600 mt-0.5 leading-relaxed">
              Ventas por categoría, rotación de stock, margen por producto y
              ranking de variantes. Por ahora mostramos los datos generales
              disponibles.
            </p>
          </div>
        </div>
      )}

      {/* ── Métricas principales ── */}
      <div data-tour="analytics-summary" className="grid grid-cols-2 gap-3">
        {loadingSummary
          ? Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface border border-border rounded-2xl p-4 space-y-2"
              >
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-20" />
              </div>
            ))
          : summary
            ? [
                {
                  label: isBooking ? "Reservas confirmadas" : "Órdenes",
                  value: summary.totalOrders,
                  icon: isBooking ? Calendar : ShoppingBag,
                  color: "text-blue-500",
                },
                {
                  label: isBooking ? "Valor de servicios" : "Ingresos USD",
                  value: formatUsd(summary.totalRevenue),
                  icon: TrendingUp,
                  color: "text-green-500",
                },
                {
                  label: isBooking ? "Precio prom." : "Ticket prom.",
                  value: formatUsd(summary.averageTicket),
                  icon: CreditCard,
                  color: "text-purple-500",
                },
                {
                  label: isBooking ? "Servicio top" : "Producto top",
                  value: summary.topProduct ?? "—",
                  icon: Package,
                  color: "text-amber-500",
                },
              ].map(({ label, value, icon: Icon, color }) => (
                <div
                  key={label}
                  className="bg-surface border border-border rounded-2xl p-4 animate-slide-up"
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={15} className={color} />
                    <p className="text-xs text-muted">{label}</p>
                  </div>
                  <p className="text-lg font-black text-app-text leading-none truncate">
                    {String(value)}
                  </p>
                </div>
              ))
            : null}
      </div>

      {/* ── Operación de cocina (food only) ── */}
      {isFood &&
        (!isPro ? (
          <UpgradeCard
            title="Tiempos operativos de cocina"
            description="Tiempo promedio de preparación, horas pico, pedidos críticos y comparativa semanal. Solo Plan Pro."
            emailSubject="Quiero Analytics Avanzado — Plan Pro"
          />
        ) : (
          <div
            data-tour="analytics-kitchen"
            className="bg-surface border border-border rounded-2xl p-5"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-semibold text-app-text text-sm flex items-center gap-2">
                <ChefHat size={15} className="text-muted" />
                Operación de cocina
              </h2>
              {kitchen && kitchen.totalMeasurable > 0 && (
                <span className="text-xs text-muted">
                  Sobre {kitchen.totalMeasurable} pedido
                  {kitchen.totalMeasurable === 1 ? "" : "s"}
                  {kitchen.totalMeasurable < kitchen.totalOrders &&
                    ` de ${kitchen.totalOrders}`}
                </span>
              )}
            </div>

            {loadingKitchen ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="bg-bg border border-border rounded-xl p-3 space-y-2"
                  >
                    <Skeleton className="h-3 w-20" />
                    <Skeleton className="h-6 w-16" />
                  </div>
                ))}
              </div>
            ) : !kitchen || kitchen.totalOrders === 0 ? (
              <p className="text-sm text-muted text-center py-4">
                Sin pedidos de cocina en este período
              </p>
            ) : kitchen.totalMeasurable === 0 ? (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
                <p className="font-semibold mb-0.5">
                  Sin datos de tiempos todavía
                </p>
                <p className="text-xs">
                  Los pedidos de este período no tienen tiempos registrados. Los
                  próximos sí van a contar — la métrica se rellena
                  automáticamente conforme entren órdenes nuevas.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {/* Tiempo en cocina (paid → ready) */}
                <KitchenCard
                  icon={<ChefHat size={14} />}
                  label="En cocina"
                  valueLabel={
                    kitchen.avgPreparingMinutes != null
                      ? `${kitchen.avgPreparingMinutes.toFixed(1)} min`
                      : "—"
                  }
                  tone={tonePreparing(
                    kitchen.avgPreparingMinutes,
                    kitchen.criticalThresholdMin,
                  )}
                  hint="paid → ready"
                />

                {/* Tiempo de entrega (ready → delivered) */}
                <KitchenCard
                  icon={<Timer size={14} />}
                  label="Entrega"
                  valueLabel={
                    kitchen.avgDeliveryMinutes != null
                      ? `${kitchen.avgDeliveryMinutes.toFixed(1)} min`
                      : "—"
                  }
                  tone={toneDelivery(kitchen.avgDeliveryMinutes)}
                  hint="ready → delivered"
                />

                {/* Pedidos críticos */}
                <KitchenCard
                  icon={<AlertTriangle size={14} />}
                  label={`Críticos (>${kitchen.criticalThresholdMin}m)`}
                  valueLabel={`${kitchen.criticalOrders} (${kitchen.criticalRate.toFixed(0)}%)`}
                  tone={toneCritical(kitchen.criticalRate)}
                  hint={`${kitchen.criticalOrders} de ${kitchen.totalMeasurable}`}
                />

                {/* Cancelaciones */}
                <KitchenCard
                  icon={<XIcon size={14} />}
                  label="Cancelaciones"
                  valueLabel={`${kitchen.cancelledOrders} (${kitchen.cancellationRate.toFixed(0)}%)`}
                  tone={toneCancellation(kitchen.cancellationRate)}
                  hint={`${kitchen.cancelledOrders} de ${kitchen.totalOrders}`}
                />
              </div>
            )}

            {kitchen &&
              kitchen.avgTotalMinutes != null &&
              kitchen.totalMeasurable > 0 && (
                <p className="text-xs text-muted text-center mt-3">
                  Tiempo total promedio (pago → entrega):{" "}
                  <span className="font-semibold text-app-text">
                    {kitchen.avgTotalMinutes.toFixed(1)} min
                  </span>
                </p>
              )}
          </div>
        ))}

      {/* ── Ingresos / Reservas por día ── */}
      <div
        data-tour="analytics-chart"
        className="bg-surface border border-border rounded-2xl p-5"
      >
        <div className="flex items-start justify-between gap-2 mb-4">
          <h2 className="font-semibold text-app-text text-sm">
            {isBooking
              ? "Reservas + Valor por día"
              : "Ingresos + Órdenes por día"}
          </h2>
          {isBooking && (
            <span className="text-[10px] text-muted bg-bg border border-border rounded-full px-2 py-0.5 flex-shrink-0">
              Valor total del servicio (incl. señas y efectivo)
            </span>
          )}
        </div>
        {loadingRevenue ? (
          <div className="flex items-end gap-1.5 h-48">
            {Array.from({ length: 14 }).map((_, i) => (
              <Skeleton
                key={i}
                className="flex-1 rounded-t-sm"
                style={{ height: `${20 + ((i * 17) % 80)}%` }}
              />
            ))}
          </div>
        ) : revenueByDay.length === 0 ? (
          <div className="h-48 flex items-center justify-center">
            <p className="text-sm text-muted">
              {isBooking
                ? "Sin reservas confirmadas en este período"
                : "Sin ventas en este período"}
            </p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={revenueByDay}
              margin={{ top: 4, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                stroke="var(--color-border, #e5e7eb)"
                vertical={false}
              />
              <XAxis
                dataKey="date"
                tickFormatter={(v: string) => v.slice(5)}
                tick={{ fontSize: 11, fill: "var(--color-muted, #9ca3af)" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                yAxisId="revenue"
                orientation="left"
                tickFormatter={(v: number) =>
                  v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v}`
                }
                tick={{ fontSize: 10, fill: "var(--color-muted, #9ca3af)" }}
                axisLine={false}
                tickLine={false}
                width={48}
              />
              <YAxis
                yAxisId="orders"
                orientation="right"
                tick={{ fontSize: 10, fill: "var(--color-muted, #9ca3af)" }}
                axisLine={false}
                tickLine={false}
                width={32}
              />
              <Tooltip
                formatter={(v, name) => {
                  if (name === "revenue" || name === "Valor servicios")
                    return [
                      `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
                      isBooking ? "Valor" : "Ingresos",
                    ];
                  return [v, isBooking ? "Reservas" : "Órdenes"];
                }}
                labelFormatter={(l) => `Día ${l}`}
                contentStyle={{
                  borderRadius: "12px",
                  border: "1px solid var(--color-border, #e5e7eb)",
                  fontSize: 12,
                  background: "var(--color-surface, #fff)",
                  color: "var(--color-app-text, #111)",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                yAxisId="revenue"
                dataKey="revenue"
                name={isBooking ? "Valor servicios" : "Ingresos USD"}
                fill="var(--color-primary, #E24B4A)"
                radius={[4, 4, 0, 0]}
                maxBarSize={32}
              />
              <Bar
                yAxisId="orders"
                dataKey="orders"
                name={isBooking ? "Reservas" : "Órdenes"}
                fill="#94A3B8"
                radius={[4, 4, 0, 0]}
                maxBarSize={20}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Métodos de pago + Tipo de pedido ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Métodos de pago */}
        <div className="bg-surface border border-border rounded-2xl p-5">
          <div className="mb-4">
            <h2 className="font-semibold text-app-text text-sm flex items-center gap-2">
              <CreditCard size={15} className="text-muted" />
              Métodos de pago
            </h2>
            {isBooking && (
              <p className="text-xs text-muted mt-0.5">
                Solo señas cobradas online
              </p>
            )}
          </div>
          {loadingPM ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-8 mb-2 rounded-lg" />
            ))
          ) : paymentMethods.length === 0 ? (
            <p className="text-sm text-muted">Sin datos</p>
          ) : (
            <div className="space-y-3">
              {paymentMethods.map((m) => {
                const pct =
                  pmTotal > 0 ? Math.round((m.totalOrders / pmTotal) * 100) : 0;
                return (
                  <div key={m.method}>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-xs font-medium text-app-text">
                        {METHOD_LABEL[m.method] ?? m.method}
                      </span>
                      <span className="text-xs text-muted">
                        {m.totalOrders} ord. · {formatUsd(m.totalRevenue)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <p className="text-[10px] text-muted mt-0.5 text-right">
                      {pct}%
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Tipo de pedido (food only) */}
        {isFood && (
          <div className="bg-surface border border-border rounded-2xl p-5">
            <h2 className="font-semibold text-app-text mb-4 text-sm flex items-center gap-2">
              <ShoppingBag size={15} className="text-muted" />
              Tipo de pedido
            </h2>
            {[
              {
                label: "🪑 Mesa",
                count: dineIn,
                pct: Math.round((dineIn / orderTypeTotal) * 100),
                color: "bg-indigo-500",
              },
              {
                label: "🥡 Para llevar",
                count: takeaway,
                pct: Math.round((takeaway / orderTypeTotal) * 100),
                color: "bg-amber-400",
              },
            ].map(({ label, count, pct, color }) => (
              <div key={label} className="mb-4">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-xs font-medium text-app-text">
                    {label}
                  </span>
                  <span className="text-xs text-muted">{count} órd.</span>
                </div>
                <div className="h-2 rounded-full bg-border overflow-hidden">
                  <div
                    className={`h-full rounded-full ${color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[10px] text-muted mt-0.5 text-right">
                  {pct}%
                </p>
              </div>
            ))}
            <p className="text-xs text-muted mt-2 text-center border-t border-border pt-3">
              Total:{" "}
              <span className="font-semibold text-app-text">
                {dineIn + takeaway}
              </span>{" "}
              órdenes
            </p>
          </div>
        )}
      </div>

      {/* ── Horas pico (food only) ── */}
      {isFood &&
        (!isPro ? (
          <UpgradeCard
            title="Distribución por hora del día"
            description="Identifica las horas pico de tu negocio y optimiza el staffing. Solo Plan Pro."
            emailSubject="Quiero Analytics Avanzado — Plan Pro"
          />
        ) : (
          <div className="bg-surface border border-border rounded-2xl p-5">
            <h2 className="font-semibold text-app-text mb-1 text-sm flex items-center gap-2">
              <Clock size={15} className="text-muted" />
              Horas pico
            </h2>
            <p className="text-xs text-muted mb-4">
              Hora Venezuela (VET = UTC-4)
            </p>
            {loadingHour ? (
              <div className="flex items-end gap-0.5 h-20">
                {Array.from({ length: 24 }).map((_, i) => (
                  <Skeleton
                    key={i}
                    className="flex-1 rounded-t-sm"
                    style={{ height: `${30 + ((i * 11) % 70)}%` }}
                  />
                ))}
              </div>
            ) : (
              <>
                {/* Simple bar chart — 24 columns */}
                {(() => {
                  const maxOrders = Math.max(
                    1,
                    ...hourlyVet.map((h) => h.totalOrders),
                  );
                  return (
                    <div className="flex items-end gap-0.5 h-24">
                      {hourlyVet.map(({ hour, totalOrders }) => {
                        const pct = (totalOrders / maxOrders) * 100;
                        const isNight = hour < 6 || hour >= 22;
                        return (
                          <div
                            key={hour}
                            className="flex-1 flex flex-col items-center gap-0.5 group"
                          >
                            <div className="relative w-full">
                              <div
                                title={`${fmtHour(hour)}: ${totalOrders} órd.`}
                                className={`w-full rounded-t-sm transition-opacity ${isNight ? "bg-slate-400" : "bg-primary"} ${totalOrders === 0 ? "opacity-20" : "opacity-90 hover:opacity-100"}`}
                                style={{
                                  height: `${Math.max(2, pct * 0.88)}px`,
                                }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
                {/* X-axis labels every 4h */}
                <div className="flex mt-1">
                  {hourlyVet.map(({ hour, label }) => (
                    <div key={hour} className="flex-1 text-center">
                      {hour % 4 === 0 && (
                        <span className="text-[9px] text-muted">{label}</span>
                      )}
                    </div>
                  ))}
                </div>
                {/* Peak hour summary */}
                {(() => {
                  const peak = hourlyVet.reduce((a, b) =>
                    a.totalOrders >= b.totalOrders ? a : b,
                  );
                  return peak.totalOrders > 0 ? (
                    <p className="text-xs text-muted mt-2 text-center">
                      Hora pico:{" "}
                      <span className="font-semibold text-app-text">
                        {fmtHour(peak.hour)}
                      </span>{" "}
                      ({peak.totalOrders} órdenes)
                    </p>
                  ) : null;
                })()}
              </>
            )}
          </div>
        ))}

      {/* ── Top productos / servicios ── */}
      <div
        data-tour="analytics-top-products"
        className="bg-surface border border-border rounded-2xl p-5"
      >
        <h2 className="font-semibold text-app-text mb-4 text-sm flex items-center gap-2">
          <Package size={15} className="text-muted" />
          {isBooking ? "Top servicios" : "Top productos"}
        </h2>
        {loadingProducts ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-16" />
              </div>
            ))}
          </div>
        ) : topProducts.length === 0 ? (
          <EmptyState
            icon={Package}
            title={
              isBooking
                ? "Sin reservas en este período"
                : "Sin ventas en este período"
            }
            description="Ajusta el rango de fechas."
          />
        ) : (
          <div className="space-y-3 animate-fade-in">
            {topProducts.slice(0, 10).map((p: any, i: number) => {
              const topQty =
                (topProducts[0] as any)?.totalQuantity ??
                (topProducts[0] as any)?.totalQty ??
                1;
              const qty = p.totalQuantity ?? p.totalQty ?? 0;
              return (
                <div key={p.productId} className="flex items-center gap-3">
                  <span className="text-sm text-muted w-5 text-right font-mono">
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-app-text truncate">
                      {p.productName}
                    </p>
                    <div className="mt-1 h-1.5 rounded-full bg-border overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{
                          width: `${Math.round((qty / topQty) * 100)}%`,
                        }}
                      />
                    </div>
                  </div>
                  <span className="text-xs text-muted w-10 text-right shrink-0">
                    {qty} u.
                  </span>
                  <span className="text-xs font-semibold text-app-text w-16 text-right shrink-0">
                    {formatUsd(p.totalRevenue)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Helpers de Operación de cocina ────────────────────────────────────────────

type Tone = "good" | "warn" | "bad" | "neutral";

const TONE_STYLES: Record<
  Tone,
  { bg: string; border: string; text: string; icon: string }
> = {
  good: {
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    text: "text-emerald-900",
    icon: "text-emerald-600",
  },
  warn: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    text: "text-amber-900",
    icon: "text-amber-600",
  },
  bad: {
    bg: "bg-red-50",
    border: "border-red-200",
    text: "text-red-900",
    icon: "text-red-600",
  },
  neutral: {
    bg: "bg-bg",
    border: "border-border",
    text: "text-app-text",
    icon: "text-muted",
  },
};

function KitchenCard({
  icon,
  label,
  valueLabel,
  tone,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  valueLabel: string;
  tone: Tone;
  hint: string;
}) {
  const s = TONE_STYLES[tone];
  return (
    <div className={`${s.bg} ${s.border} border rounded-xl p-3`}>
      <div className={`flex items-center gap-1.5 ${s.icon} mb-1.5`}>
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <p className={`text-base font-bold leading-none ${s.text}`}>
        {valueLabel}
      </p>
      <p className="text-xs text-muted mt-1 truncate">{hint}</p>
    </div>
  );
}

/** Verde si está fluido, amarillo si se acerca al umbral crítico, rojo si lo pasó. */
function tonePreparing(avg: number | null, threshold: number): Tone {
  if (avg == null) return "neutral";
  if (avg <= threshold * 0.7) return "good"; // <= 70% del umbral (ej. 10.5 si threshold=15)
  if (avg <= threshold) return "warn"; // entre 70% y 100% del umbral
  return "bad";
}

/** Tiempo de entrega ready→delivered: idealmente <3 min en food rápida. */
function toneDelivery(avg: number | null): Tone {
  if (avg == null) return "neutral";
  if (avg <= 3) return "good";
  if (avg <= 7) return "warn";
  return "bad";
}

/** % de pedidos críticos. 0% verde, >10% rojo. */
function toneCritical(rate: number): Tone {
  if (rate === 0) return "good";
  if (rate <= 10) return "warn";
  return "bad";
}

/** Tasa de cancelación. <=2% verde, hasta 5% amarillo, sobre 5% rojo. */
function toneCancellation(rate: number): Tone {
  if (rate <= 2) return "good";
  if (rate <= 5) return "warn";
  return "bad";
}
