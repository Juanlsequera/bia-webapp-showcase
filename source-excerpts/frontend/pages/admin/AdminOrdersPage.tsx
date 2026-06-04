import React, { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ClipboardList, Download } from "lucide-react";
import { analyticsApi, type AnalyticsOrdersFilter } from "../../lib/api";
import { Button, Badge, Skeleton, EmptyState } from "../../components/ui";
import { formatUsd } from "../../lib/money";
import { useTour } from "../../hooks/use-tour";
import { TourTrigger } from "../../components/tour/TourTrigger";
import { adminOrdersSteps } from "../../lib/tours/admin-orders.tour";

// ── types ─────────────────────────────────────────────────────────────────────

interface OrderListItem {
  orderId: string;
  orderType?: string;
  tableNumber: number | null;
  pickup_code?: string | null;
  customer_name?: string | null;
  total: number;
  status: string;
  paymentMethod: string;
  itemCount: number;
  createdAt: string;
}

interface OrdersResponse {
  data: OrderListItem[];
  total: number;
  page: number;
  limit: number;
}

// ── constantes ────────────────────────────────────────────────────────────────

const STATUS_META: Record<
  string,
  {
    label: string;
    variant: "success" | "warning" | "danger" | "info" | "neutral";
  }
> = {
  // Food / Retail
  pending_cash: { label: "Pend. caja", variant: "warning" },
  confirmed: { label: "Confirmada", variant: "info" },
  pending_verification: { label: "Verif. pago", variant: "warning" },
  paid: { label: "Pagada", variant: "info" },
  preparing: { label: "Preparando", variant: "info" },
  ready: { label: "Lista", variant: "success" },
  delivered: { label: "Entregada", variant: "success" },
  cancelled: { label: "Cancelada", variant: "danger" },
  // Service
  inquiry: { label: "Solicitud", variant: "info" },
  quoted: { label: "Cotizada", variant: "warning" },
  approved: { label: "Aprobada", variant: "success" },
  in_progress: { label: "En trabajo", variant: "info" },
  completed: { label: "Completada", variant: "success" },
  rejected: { label: "Rechazada", variant: "danger" },
  // Booking
  scheduled: { label: "Agendada", variant: "info" },
  no_show: { label: "No asistió", variant: "danger" },
  rescheduled: { label: "Reprogramada", variant: "warning" },
};

const METHOD_LABEL: Record<string, string> = {
  pagomovil: "PagoMóvil",
  cash: "Efectivo",
  stripe: "Stripe",
  mercadopago: "MercadoPago",
};

const LIMIT = 50;

// ── page ──────────────────────────────────────────────────────────────────────

export function AdminOrdersPage() {
  const today = new Date().toISOString().slice(0, 10);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [status, setStatus] = useState("");
  const [method, setMethod] = useState("");
  const [tableNumber, setTableNumber] = useState("");
  const [orderType, setOrderType] = useState("");
  const [page, setPage] = useState(1);

  const filter: AnalyticsOrdersFilter = {
    dateFrom,
    dateTo,
    page,
    limit: LIMIT,
    status: status || undefined,
    paymentMethod: method || undefined,
    tableNumber: tableNumber || undefined,
    orderType: orderType || undefined,
  };

  const { data, isLoading } = useQuery<OrdersResponse>({
    queryKey: [
      "admin-orders",
      dateFrom,
      dateTo,
      status,
      method,
      tableNumber,
      orderType,
      page,
    ],
    queryFn: () => analyticsApi.orders<OrdersResponse>(filter),
    // On-demand: fetch al entrar y al cambiar filtros/página, nunca solo.
    refetchOnWindowFocus: false,
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  const handleExport = () => {
    analyticsApi.exportCsv(filter, `ordenes-${dateFrom}-${dateTo}.csv`);
  };

  const resetPage = () => setPage(1);

  const { start: startTour } = useTour("admin-orders", adminOrdersSteps);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <TourTrigger onStart={startTour} />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-app-text">Órdenes</h1>
          <p className="text-sm text-muted">Historial de órdenes del período</p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={handleExport}
          data-tour="orders-export"
        >
          <Download size={15} className="mr-1.5" />
          Descargar CSV
        </Button>
      </div>

      {/* Filtros */}
      <div
        data-tour="orders-filters"
        className="bg-surface border border-border rounded-2xl p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
      >
        <FilterField label="Desde">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              resetPage();
            }}
            className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-bg text-app-text focus:outline-none focus:border-primary"
          />
        </FilterField>
        <FilterField label="Hasta">
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              resetPage();
            }}
            className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-bg text-app-text focus:outline-none focus:border-primary"
          />
        </FilterField>
        <FilterField label="Estado">
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              resetPage();
            }}
            className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-bg text-app-text focus:outline-none focus:border-primary"
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_META).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Método">
          <select
            value={method}
            onChange={(e) => {
              setMethod(e.target.value);
              resetPage();
            }}
            className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-bg text-app-text focus:outline-none focus:border-primary"
          >
            <option value="">Todos</option>
            {Object.entries(METHOD_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </FilterField>
        <FilterField label="Tipo">
          <select
            value={orderType}
            onChange={(e) => {
              setOrderType(e.target.value);
              resetPage();
            }}
            className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-bg text-app-text focus:outline-none focus:border-primary"
          >
            <option value="">Todos</option>
            <option value="dine_in">🪑 En mesa</option>
            <option value="takeaway">🥡 Para llevar</option>
          </select>
        </FilterField>
        <FilterField label="Mesa">
          <input
            type="number"
            min={1}
            value={tableNumber}
            onChange={(e) => {
              setTableNumber(e.target.value);
              resetPage();
            }}
            placeholder="Nro"
            className="w-full border border-border rounded-xl px-3 py-2.5 text-base bg-bg text-app-text focus:outline-none focus:border-primary"
          />
        </FilterField>
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-2xl" />
          ))}
        </div>
      )}

      {/* Empty */}
      {!isLoading && data?.data.length === 0 && (
        <EmptyState
          icon={ClipboardList}
          title="Sin órdenes"
          description="No hay órdenes en el período y filtros seleccionados."
        />
      )}

      {/* Tabla */}
      {!isLoading && data && data.data.length > 0 && (
        <div
          data-tour="orders-table"
          className="bg-surface border border-border rounded-2xl overflow-hidden"
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-bg text-muted border-b border-border">
                <tr>
                  <Th>Hora</Th>
                  <Th>Tipo / Mesa</Th>
                  <Th>Estado</Th>
                  <Th>Método</Th>
                  <Th>Items</Th>
                  <Th>Total</Th>
                  <Th>ID</Th>
                </tr>
              </thead>
              <tbody>
                {data.data.map((o) => (
                  <OrderRow key={o.orderId} order={o} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Paginación + totales */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border text-sm">
            <span className="text-muted">
              {data.total} resultado{data.total !== 1 ? "s" : ""} · pág. {page}/
              {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="px-3 py-1 border border-border rounded-lg text-muted disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
              >
                ←
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="px-3 py-1 border border-border rounded-lg text-muted disabled:opacity-40 hover:border-primary hover:text-primary transition-colors"
              >
                →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── OrderRow ───────────────────────────────────────────────────────────────────

function OrderRow({ order }: { order: OrderListItem }) {
  const meta = STATUS_META[order.status] ?? {
    label: order.status,
    variant: "neutral" as const,
  };
  return (
    <tr className="border-t border-border hover:bg-bg/60 transition-colors">
      <td className="px-3 py-2.5 text-xs text-muted whitespace-nowrap">
        {new Date(order.createdAt).toLocaleTimeString("es-VE", {
          hour: "2-digit",
          minute: "2-digit",
        })}
        <span className="block text-[10px]">
          {new Date(order.createdAt).toLocaleDateString("es-VE", {
            day: "2-digit",
            month: "2-digit",
          })}
        </span>
      </td>
      <td className="px-3 py-2.5 font-semibold text-app-text whitespace-nowrap">
        {order.orderType === "takeaway" ? (
          <span className="inline-flex items-center gap-1 text-blue-600">
            <span>🥡</span>
            <span>
              {order.pickup_code ?? "Llevar"}
              {order.customer_name ? ` · ${order.customer_name}` : ""}
            </span>
          </span>
        ) : (
          <span>🪑 {order.tableNumber ?? "—"}</span>
        )}
      </td>
      <td className="px-3 py-2.5" data-tour="orders-status-badge">
        <Badge variant={meta.variant}>{meta.label}</Badge>
      </td>
      <td className="px-3 py-2.5 text-muted text-xs">
        {METHOD_LABEL[order.paymentMethod] ?? order.paymentMethod}
      </td>
      <td className="px-3 py-2.5 text-muted text-center">{order.itemCount}</td>
      <td className="px-3 py-2.5 font-semibold text-app-text">
        {formatUsd(order.total)}
      </td>
      <td className="px-3 py-2.5 font-mono text-xs text-muted">
        {order.orderId.slice(-6)}
      </td>
    </tr>
  );
}

// ── FilterField ───────────────────────────────────────────────────────────────

function FilterField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="text-xs text-muted block mb-1">{label}</label>
      {children}
    </div>
  );
}

// ── Th ────────────────────────────────────────────────────────────────────────

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-3 py-2.5 text-left text-xs font-medium text-muted whitespace-nowrap">
      {children}
    </th>
  );
}
