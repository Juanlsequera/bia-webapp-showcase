import clsx from "clsx";
import { OrderStatus, OrderArchetype } from "@foodorder/types";

interface StatusBadgeProps {
  status: OrderStatus;
  archetype: OrderArchetype;
  size?: "sm" | "md";
}

// ─── Status maps ──────────────────────────────────────────────────────────────

type ColorVariant = "success" | "warning" | "danger" | "info" | "neutral";

interface StatusMeta {
  label: string;
  color: ColorVariant;
}

const STATUS_MAP: Record<
  OrderArchetype,
  Partial<Record<OrderStatus, StatusMeta>>
> = {
  retail: {
    pending: { label: "Pendiente", color: "warning" },
    payment_review: { label: "Verificando", color: "info" },
    confirmed: { label: "Confirmado", color: "success" },
    processing: { label: "Procesando", color: "info" },
    shipped: { label: "Enviado", color: "info" },
    delivered: { label: "Entregado", color: "success" },
    cancelled: { label: "Cancelado", color: "danger" },
    returned: { label: "Devuelto", color: "warning" },
  },
  food: {
    pending: { label: "Recibida", color: "warning" },
    pending_verification: { label: "Verificando pago", color: "info" },
    pending_cash: { label: "Pago en efectivo", color: "warning" },
    payment_review: { label: "Verificando", color: "info" },
    paid: { label: "Pagado", color: "success" },
    confirmed: { label: "Confirmado", color: "success" },
    in_kitchen: { label: "En cocina", color: "warning" },
    preparing: { label: "Preparando", color: "warning" },
    ready: { label: "Listo ✓", color: "success" },
    delivered: { label: "Entregado", color: "success" },
    cancelled: { label: "Cancelado", color: "danger" },
  },
  booking: {
    pending: { label: "Por confirmar", color: "warning" },
    confirmed: { label: "Confirmada", color: "success" },
    reminder_sent: { label: "Recordatorio", color: "info" },
    in_progress: { label: "En curso", color: "info" },
    completed: { label: "Completada", color: "success" },
    cancelled: { label: "Cancelada", color: "danger" },
    no_show: { label: "No asistió", color: "danger" },
    rescheduled: { label: "Reprogramada", color: "warning" },
  },
  service: {
    inquiry: { label: "Consulta", color: "info" },
    quoted: { label: "Cotizado", color: "warning" },
    approved: { label: "Aprobado", color: "success" },
    scheduled: { label: "Agendado", color: "info" },
    in_progress: { label: "En proceso", color: "info" },
    completed: { label: "Completado", color: "success" },
    cancelled: { label: "Cancelado", color: "danger" },
  },
};

// ─── Color classes ────────────────────────────────────────────────────────────

const COLOR_CLASSES: Record<ColorVariant, string> = {
  success: "bg-green-50  text-green-700",
  warning: "bg-amber-50  text-amber-700",
  danger: "bg-red-50    text-red-600",
  info: "bg-blue-50   text-blue-700",
  neutral: "bg-gray-100  text-gray-600",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function StatusBadge({
  status,
  archetype,
  size = "sm",
}: StatusBadgeProps) {
  const meta = STATUS_MAP[archetype]?.[status] ?? {
    label: status,
    color: "neutral" as ColorVariant,
  };

  return (
    <span
      className={clsx(
        "inline-flex items-center rounded-full font-semibold",
        COLOR_CLASSES[meta.color],
        size === "sm" ? "text-[11px] px-2 py-0.5" : "text-xs px-2.5 py-1",
      )}
    >
      {meta.label}
    </span>
  );
}

/**
 * Devuelve el label y color para un status sin renderizar el badge.
 * Útil para lógica condicional o tooltips.
 */
export function getStatusMeta(
  status: OrderStatus,
  archetype: OrderArchetype,
): StatusMeta {
  return STATUS_MAP[archetype]?.[status] ?? { label: status, color: "neutral" };
}
