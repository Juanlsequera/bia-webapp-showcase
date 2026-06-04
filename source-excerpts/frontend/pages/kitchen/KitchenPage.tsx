import { useEffect, useRef, useCallback, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { SocketEvent, roomName } from "@foodorder/types";
import { useParams, Link } from "react-router-dom";
import { ordersApi } from "../../lib/api";
import { extractErrorMessage } from "../../lib/extract-error-message";
import { toast } from "sonner";
import { useAuthStore } from "../../stores/auth.store";
import { useSocketRoom, useSocketEvent } from "../../hooks/useSocketRoom";
import { useTour } from "../../hooks/use-tour";
import { TourTrigger } from "../../components/tour/TourTrigger";
import { kitchenKdsSteps } from "../../lib/tours/kitchen-kds.tour";
import { playNewOrderBeep, playReadyChime } from "../../lib/sounds";

// ── columnas del KDS ──────────────────────────────────────────────────────────

interface ColConfig {
  status: string;
  label: string;
  emptyText: string;
  headerCls: string;
  countCls: string;
  // acción que avanza el estado
  action?: { label: string; next: string; btnCls: string };
  // acción para pending_cash: confirmar cobro
  cashAction?: boolean;
}

const COLUMNS: ColConfig[] = [
  {
    status: "pending_cash",
    label: "Pendiente caja",
    emptyText: "Sin cobros pendientes",
    headerCls: "text-yellow-400 border-yellow-500/30",
    countCls: "bg-yellow-500/20 text-yellow-300",
    cashAction: true,
  },
  {
    status: "paid",
    label: "Nuevos",
    emptyText: "Sin pedidos nuevos",
    headerCls: "text-blue-400 border-blue-500/30",
    countCls: "bg-blue-500/20 text-blue-300",
    action: {
      label: "Tomar pedido",
      next: "preparing",
      btnCls: "bg-blue-600 hover:bg-blue-500 active:scale-95",
    },
  },
  {
    status: "preparing",
    label: "Preparando",
    emptyText: "Nada en preparación",
    headerCls: "text-orange-400 border-orange-500/30",
    countCls: "bg-orange-500/20 text-orange-300",
    action: {
      label: "Marcar listo",
      next: "ready",
      btnCls: "bg-orange-500 hover:bg-orange-400 active:scale-95",
    },
  },
  {
    status: "ready",
    label: "Listos",
    emptyText: "Nada listo todavía",
    headerCls: "text-green-400 border-green-500/30",
    countCls: "bg-green-500/20 text-green-300",
    action: {
      label: "Entregar",
      next: "delivered",
      btnCls: "bg-green-600 hover:bg-green-500 active:scale-95",
    },
  },
];

// ── KitchenPage ───────────────────────────────────────────────────────────────

export function KitchenPage() {
  const { user } = useAuthStore();
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const qc = useQueryClient();
  const isFirstLoad = useRef(true);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [newOrderFlash, setNewOrderFlash] = useState(false);

  // ── orders activas (paid | preparing | ready) ──────────────────────────────
  // WS es el mecanismo principal; polling es solo fallback ante desconexión.
  // 60 s en vez de 10 s para no presionar el throttler (default 30 req/min).
  const { data: activeOrders = [], isLoading: loadingActive } = useQuery({
    queryKey: ["kitchen-orders"],
    queryFn: ordersApi.listKitchen,
    refetchInterval: (query) =>
      query.state.status === "error" ? false : 60_000,
    refetchOnWindowFocus: false,
  });

  // ── pending_cash (kitchen/admin pueden verlas y confirmarlas) ──────────────
  const { data: cashOrders = [], isLoading: loadingCash } = useQuery({
    queryKey: ["kitchen-pending-cash"],
    queryFn: ordersApi.listPendingCash,
    refetchInterval: (query) =>
      query.state.status === "error" ? false : 60_000,
    refetchOnWindowFocus: false,
  });

  const allOrders = [...cashOrders, ...activeOrders];
  const isLoading = loadingActive || loadingCash;

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useSocketRoom(user?.tenantId ? roomName.kitchen(user.tenantId) : null);

  const refresh = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["kitchen-orders"] });
      qc.invalidateQueries({ queryKey: ["kitchen-pending-cash"] });
    }, 300);
  }, [qc]);

  const handleNewOrder = useCallback(() => {
    refresh();
    if (!isFirstLoad.current) {
      playNewOrderBeep();
      setNewOrderFlash(true);
      setTimeout(() => setNewOrderFlash(false), 3000);
    }
  }, [refresh]);

  const handleStatusChanged = useCallback(
    (data: { status: string }) => {
      refresh();
      if (data?.status === "ready") {
        playReadyChime();
      }
    },
    [refresh],
  );

  useSocketEvent(SocketEvent.NEW_ORDER, handleNewOrder);
  useSocketEvent(SocketEvent.NEW_CASH_ORDER, handleNewOrder);
  useSocketEvent(SocketEvent.ORDER_STATUS_CHANGED, handleStatusChanged);

  // Marcar primera carga como completada
  useEffect(() => {
    if (!isLoading) isFirstLoad.current = false;
  }, [isLoading]);

  // ── mutaciones ─────────────────────────────────────────────────────────────
  const updateStatus = useMutation({
    // El `next` de COLUMNS está tipado como string; lo cast a la union real del DTO.
    mutationFn: ({ orderId, status }: { orderId: string; status: string }) =>
      ordersApi.updateStatus(orderId, {
        status: status as "preparing" | "ready" | "delivered" | "cancelled",
      }),
    onSuccess: refresh,
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo actualizar el estado")),
  });

  const isBusy = updateStatus.isPending;

  const { start: startTour } = useTour("kitchen-kds", kitchenKdsSteps);

  // ── agrupado por status ────────────────────────────────────────────────────
  const grouped = Object.fromEntries(
    COLUMNS.map((col) => [
      col.status,
      allOrders.filter((o: any) => o.status === col.status),
    ]),
  );

  const totalActive = allOrders.length;

  return (
    // h-full porque KitchenLayout ya es h-screen flex-col, este div ocupa el resto
    <div className="h-full flex flex-col">
      <TourTrigger onStart={startTour} position="bottom-left" />
      {/* Stats bar */}
      <div className="flex-shrink-0 bg-gray-900/60 border-b border-gray-800 px-4 py-2 flex items-center gap-4 text-xs">
        <span className="text-gray-400">
          {isLoading ? (
            "Cargando…"
          ) : (
            <>
              {totalActive} orden{totalActive !== 1 ? "es" : ""} activa
              {totalActive !== 1 ? "s" : ""}
            </>
          )}
        </span>
        {COLUMNS.map((col) => {
          const count = grouped[col.status]?.length ?? 0;
          if (count === 0) return null;
          return (
            <span
              key={col.status}
              className={`px-2 py-0.5 rounded-full font-semibold ${col.countCls}`}
            >
              {col.label}: {count}
            </span>
          );
        })}
        <Link
          data-tour="kitchen-tv-link"
          to={`/${tenantSlug}/cocina/tv`}
          className="ml-auto text-gray-600 hover:text-gray-400 transition-colors"
          title="Ver pantalla TV"
        >
          TV →
        </Link>
      </div>

      {/* KDS — 4 columnas en tablet landscape, scroll por móvil */}
      <div
        data-tour="kitchen-columns"
        className="flex-1 overflow-hidden flex divide-x divide-gray-800 overflow-x-auto"
      >
        {COLUMNS.map((col) => {
          const orders = grouped[col.status] ?? [];
          return (
            <KdsColumn
              key={col.status}
              col={col}
              orders={orders}
              isBusy={isBusy}
              flash={col.status === "paid" && newOrderFlash}
              onAction={(orderId, next) =>
                updateStatus.mutate({ orderId, status: next })
              }
            />
          );
        })}
      </div>
    </div>
  );
}

// ── KdsColumn ─────────────────────────────────────────────────────────────────

function KdsColumn({
  col,
  orders,
  isBusy,
  flash,
  onAction,
}: {
  col: ColConfig;
  orders: any[];
  isBusy: boolean;
  flash?: boolean;
  onAction: (orderId: string, next: string) => void;
}) {
  return (
    <div className="flex-1 min-w-[240px] flex flex-col">
      {/* Cabecera de columna */}
      <div
        className={`flex-shrink-0 px-3 py-2.5 border-b flex items-center justify-between ${col.headerCls} ${flash ? "animate-pulse" : ""}`}
      >
        <span className="text-xs font-bold uppercase tracking-wider">
          {col.label}
        </span>
        {orders.length > 0 && (
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded-full ${col.countCls}`}
          >
            {orders.length}
          </span>
        )}
      </div>

      {/* Cards con scroll independiente */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2.5">
        {orders.length === 0 && (
          <div className="h-full flex items-center justify-center">
            <p className="text-gray-700 text-sm">{col.emptyText}</p>
          </div>
        )}

        {orders.map((order: any) => (
          <OrderCard
            key={order._id}
            order={order}
            col={col}
            isBusy={isBusy}
            onAction={onAction}
          />
        ))}
      </div>
    </div>
  );
}

// ── OrderCard ─────────────────────────────────────────────────────────────────

function OrderCard({
  order,
  col,
  isBusy,
  onAction,
}: {
  order: any;
  col: ColConfig;
  isBusy: boolean;
  onAction: (orderId: string, next: string) => void;
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      {/* Header de la card */}
      <div className="px-3 pt-3 pb-2 flex items-start justify-between gap-2">
        <div>
          {order.orderType === "takeaway" ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full font-semibold">
                🥡 Llevar
              </span>
              <p className="text-2xl font-black text-white leading-none">
                {order.pickup_code ?? "?"}
              </p>
              {order.customer_name && (
                <p className="text-sm text-gray-400 font-medium truncate max-w-[120px]">
                  · {order.customer_name}
                </p>
              )}
            </div>
          ) : (
            <p className="text-2xl font-black text-white leading-none">
              Mesa {order.tableNumber}
            </p>
          )}
          <ElapsedTime createdAt={order.createdAt} />
        </div>
        <div className="text-right text-xs text-gray-500 mt-0.5 space-y-0.5">
          {order.orderNumber != null && (
            <div className="text-gray-300 font-black text-base leading-none">
              #{order.orderNumber}
            </div>
          )}
          {new Date(order.createdAt).toLocaleTimeString("es-VE", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      </div>

      {/* Items */}
      <div className="px-3 pb-2 space-y-1.5">
        {order.items?.map((item: any, i: number) => (
          <div key={i} className="flex items-start gap-2">
            <span className="text-white font-black text-base leading-tight w-6 text-right flex-shrink-0">
              {item.quantity}×
            </span>
            <div className="min-w-0">
              <span className="text-gray-200 text-sm leading-tight">
                {item.productName}
              </span>
              {item.notes && (
                <p className="text-yellow-400 text-xs italic mt-0.5">
                  "{item.notes}"
                </p>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Botón de acción */}
      {col.cashAction && (
        <div className="w-full py-2.5 px-3 bg-yellow-500/10 border-t border-yellow-500/20 text-yellow-400 text-xs font-semibold text-center">
          Pendiente de cobro — el admin confirma desde el dashboard
        </div>
      )}
      {col.action && (
        <button
          data-tour="kitchen-card-action"
          onClick={() => onAction(order._id, col.action!.next)}
          disabled={isBusy}
          className={`w-full py-3 text-white font-black text-sm transition-all disabled:opacity-50 ${col.action.btnCls}`}
        >
          {col.action.label}
        </button>
      )}
    </div>
  );
}

// ── OrderTimer ────────────────────────────────────────────────────────────────
// Actualiza cada minuto y muestra colores de urgencia.

function useMinuteTicker() {
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 60000);
    return () => clearInterval(id);
  }, []);
}

function ElapsedTime({ createdAt }: { createdAt: string }) {
  useMinuteTicker();
  const mins = Math.floor((Date.now() - new Date(createdAt).getTime()) / 60000);
  const [bg, color] =
    mins < 5
      ? ["#14532D", "#4ADE80"]
      : mins < 12
        ? ["#713F12", "#FCD34D"]
        : ["#7F1D1D", "#FCA5A5"];
  return (
    <span
      data-tour="kitchen-elapsed"
      style={{
        background: bg,
        color,
        fontWeight: 700,
        fontSize: 12,
        padding: "3px 8px",
        borderRadius: 8,
        display: "inline-block",
        marginTop: 4,
      }}
    >
      {"⏱"} {mins < 1 ? "<1" : mins} min
    </span>
  );
}
