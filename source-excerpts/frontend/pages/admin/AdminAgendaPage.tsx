import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { useTenant } from "../../lib/tenant";
import { Button, Badge } from "../../components/ui";
import { useTour } from "../../hooks/use-tour";
import { adminAgendaSteps } from "../../lib/tours/admin-agenda.tour";

type ActionModal =
  | { type: "reschedule"; booking: any }
  | { type: "cancel"; booking: any }
  | null;

const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendado",
  pending: "Pendiente",
  confirmed: "Confirmado",
  reminder_sent: "Recordado",
  in_progress: "En atención",
  completed: "Completado",
  cancelled: "Cancelado",
  rescheduled: "Reprogramado",
  no_show: "No se presentó",
};

export function AdminAgendaPage() {
  const tenant = useTenant();
  const queryClient = useQueryClient();
  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  useTour("admin-agenda", adminAgendaSteps);

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ["admin-bookings", selectedDate],
    queryFn: async () => {
      const res = await api.get(`/admin/bookings?date=${selectedDate}`);
      return res.data || [];
    },
    enabled: !!tenant && !!selectedDate,
  });

  const rescheduleMutation = useMutation({
    mutationFn: async ({
      bookingId,
      staffId,
      bookingDatetime,
    }: {
      bookingId: string;
      staffId: string;
      bookingDatetime: string;
    }) => {
      const res = await api.post(
        `/${tenant!.slug}/orders/${bookingId}/reschedule`,
        { staffId, bookingDatetime },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-bookings"] });
      setActionModal(null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: async ({
      bookingId,
      reason,
    }: {
      bookingId: string;
      reason?: string;
    }) => {
      const res = await api.post(
        `/${tenant!.slug}/orders/${bookingId}/cancel-booking`,
        { reason },
      );
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-bookings"] });
      setActionModal(null);
    },
  });

  // R6: transiciones de estado rápidas desde la agenda
  const statusMutation = useMutation({
    mutationFn: async ({
      bookingId,
      status,
    }: {
      bookingId: string;
      status: string;
    }) => {
      const res = await api.patch(`/admin/orders/${bookingId}/status`, {
        status,
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-bookings"] });
    },
  });

  // Agrupar bookings por staff
  const groupedByStaff = bookings.reduce(
    (acc: Record<string, any>, booking: any) => {
      const staffId = booking.staffId?._id || "sin-asignar";
      if (!acc[staffId]) {
        acc[staffId] = { staff: booking.staffId, bookings: [] };
      }
      acc[staffId].bookings.push(booking);
      return acc;
    },
    {} as Record<string, any>,
  );

  // Ordenar bookings por hora
  Object.values(groupedByStaff).forEach((group: any) => {
    group.bookings.sort(
      (a: any, b: any) =>
        new Date(a.bookingDatetime).getTime() -
        new Date(b.bookingDatetime).getTime(),
    );
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div data-tour="agenda-header" className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Agenda</h1>
        <p className="text-sm text-gray-500 mt-1">
          Citas y reservas programadas
        </p>
      </div>

      {/* Date picker */}
      <div
        data-tour="agenda-date-picker"
        className="mb-6 flex items-center gap-4"
      >
        <div>
          <label className="text-sm text-gray-600 block mb-2">
            Selecciona una fecha
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="border border-gray-200 rounded-lg px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <Button
          onClick={() =>
            setSelectedDate(new Date().toISOString().split("T")[0])
          }
          variant="ghost"
        >
          Hoy
        </Button>
      </div>

      {/* Bookings grouped by staff */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">
          Cargando agenda...
        </div>
      ) : Object.keys(groupedByStaff).length === 0 ? (
        <div className="bg-white rounded-xl shadow-sm p-12 text-center">
          <p className="text-gray-400 mb-4">
            📅 Sin citas programadas para este día
          </p>
        </div>
      ) : (
        <div data-tour="agenda-bookings" className="space-y-6">
          {Object.entries(groupedByStaff).map(([_, group]: any) => (
            <div
              key={group.staff?._id || "sin-asignar"}
              className="bg-white rounded-xl shadow-sm overflow-hidden"
            >
              <div className="bg-gray-50 px-6 py-3 border-b border-gray-100">
                <h2 className="font-semibold text-gray-900">
                  {group.staff?.name || "Sin asignar"}
                </h2>
              </div>
              <div className="divide-y">
                {group.bookings.map((booking: any) => {
                  const datetime = new Date(booking.bookingDatetime);
                  const time = datetime.toLocaleTimeString("es-VE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  });
                  const statusColor =
                    booking.status === "confirmed"
                      ? "bg-green-100 text-green-800"
                      : booking.status === "reminder_sent"
                        ? "bg-blue-100 text-blue-800"
                        : booking.status === "in_progress"
                          ? "bg-purple-100 text-purple-800"
                          : booking.status === "completed"
                            ? "bg-gray-100 text-gray-600"
                            : booking.status === "cancelled"
                              ? "bg-red-100 text-red-800"
                              : booking.status === "rescheduled"
                                ? "bg-yellow-100 text-yellow-800"
                                : booking.status === "no_show"
                                  ? "bg-orange-100 text-orange-800"
                                  : "bg-indigo-100 text-indigo-800"; // scheduled / pending

                  const isTerminal = [
                    "completed",
                    "cancelled",
                    "no_show",
                  ].includes(booking.status);

                  return (
                    <div
                      key={booking._id}
                      className="px-6 py-4 flex items-start justify-between gap-4 hover:bg-gray-50"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-lg font-bold text-indigo-600">
                            {time}
                          </span>
                          <Badge className={statusColor}>
                            {STATUS_LABELS[booking.status] ?? booking.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-800 font-medium">
                          {booking.customer_name || "Sin nombre"}
                        </p>
                        {booking.customer_phone && (
                          <p className="text-sm text-gray-500">
                            {booking.customer_phone}
                          </p>
                        )}
                      </div>

                      {!isTerminal && (
                        <div
                          data-tour="agenda-actions"
                          className="flex flex-col gap-1.5 shrink-0"
                        >
                          {/* R6: Confirmar (scheduled → confirmed) */}
                          {(booking.status === "scheduled" ||
                            booking.status === "pending") && (
                            <Button
                              size="sm"
                              className="bg-green-600 text-white text-xs"
                              disabled={statusMutation.isPending}
                              onClick={() =>
                                statusMutation.mutate({
                                  bookingId: booking._id,
                                  status: "confirmed",
                                })
                              }
                            >
                              Confirmar
                            </Button>
                          )}
                          {/* R6: Iniciar atención (confirmed/reminder_sent/scheduled → in_progress) */}
                          {["scheduled", "confirmed", "reminder_sent"].includes(
                            booking.status,
                          ) && (
                            <Button
                              size="sm"
                              className="bg-purple-600 text-white text-xs"
                              disabled={statusMutation.isPending}
                              onClick={() =>
                                statusMutation.mutate({
                                  bookingId: booking._id,
                                  status: "in_progress",
                                })
                              }
                            >
                              Iniciar atención
                            </Button>
                          )}
                          {/* R6: Completar (in_progress → completed) */}
                          {booking.status === "in_progress" && (
                            <Button
                              size="sm"
                              className="bg-indigo-600 text-white text-xs"
                              disabled={statusMutation.isPending}
                              onClick={() =>
                                statusMutation.mutate({
                                  bookingId: booking._id,
                                  status: "completed",
                                })
                              }
                            >
                              Completar
                            </Button>
                          )}
                          {/* Más acciones */}
                          <div className="relative group">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs w-full"
                            >
                              ⋯
                            </Button>
                            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg border border-gray-100 z-10 min-w-[160px] hidden group-focus-within:block group-hover:block">
                              {!["cancelled", "completed", "no_show"].includes(
                                booking.status,
                              ) && (
                                <button
                                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-t-lg"
                                  onClick={() =>
                                    setActionModal({
                                      type: "reschedule",
                                      booking,
                                    })
                                  }
                                >
                                  🗓 Reprogramar
                                </button>
                              )}
                              {!["cancelled", "completed"].includes(
                                booking.status,
                              ) && (
                                <button
                                  className="w-full text-left px-4 py-2 text-sm text-orange-600 hover:bg-orange-50"
                                  onClick={() =>
                                    statusMutation.mutate({
                                      bookingId: booking._id,
                                      status: "no_show",
                                    })
                                  }
                                >
                                  👻 No se presentó
                                </button>
                              )}
                              <button
                                className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-b-lg"
                                onClick={() =>
                                  setActionModal({ type: "cancel", booking })
                                }
                              >
                                ✕ Cancelar cita
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal Reprogramar */}
      {actionModal?.type === "reschedule" && (
        <RescheduleModal
          booking={actionModal.booking}
          isLoading={rescheduleMutation.isPending}
          onClose={() => setActionModal(null)}
          onSubmit={({ bookingDatetime }) =>
            rescheduleMutation.mutate({
              bookingId: actionModal.booking._id,
              staffId:
                actionModal.booking.staffId?._id ?? actionModal.booking.staffId,
              bookingDatetime,
            })
          }
        />
      )}

      {/* Modal Cancelar */}
      {actionModal?.type === "cancel" && (
        <CancelModal
          booking={actionModal.booking}
          isLoading={cancelMutation.isPending}
          onClose={() => setActionModal(null)}
          onSubmit={({ reason }) =>
            cancelMutation.mutate({
              bookingId: actionModal.booking._id,
              reason,
            })
          }
        />
      )}
    </div>
  );
}

// ─── Modal Reprogramar ────────────────────────────────────────────────────────

function RescheduleModal({
  booking,
  isLoading,
  onClose,
  onSubmit,
}: {
  booking: any;
  isLoading: boolean;
  onClose: () => void;
  onSubmit: (data: { bookingDatetime: string }) => void;
}) {
  const current = booking.bookingDatetime
    ? new Date(booking.bookingDatetime).toISOString().slice(0, 16)
    : "";
  const [bookingDatetime, setBookingDatetime] = useState(current);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">
          Reprogramar cita
        </h2>
        <p className="text-sm text-gray-500 mb-4">
          Cliente: {booking.customer_name || "N/A"}
        </p>
        <div className="mb-4">
          <label className="text-sm text-gray-600 block mb-1">
            Nueva fecha y hora
          </label>
          <input
            type="datetime-local"
            value={bookingDatetime}
            onChange={(e) => setBookingDatetime(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={onClose}
            disabled={isLoading}
          >
            Cancelar
          </Button>
          <Button
            className="flex-1 bg-indigo-600 text-white"
            disabled={isLoading || !bookingDatetime}
            onClick={() => onSubmit({ bookingDatetime })}
          >
            {isLoading ? "Guardando..." : "Confirmar"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal Cancelar ───────────────────────────────────────────────────────────

function CancelModal({
  booking,
  isLoading,
  onClose,
  onSubmit,
}: {
  booking: any;
  isLoading: boolean;
  onClose: () => void;
  onSubmit: (data: { reason?: string }) => void;
}) {
  const [reason, setReason] = useState("");

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl max-w-sm w-full p-6">
        <h2 className="text-lg font-bold text-gray-900 mb-1">Cancelar cita</h2>
        <p className="text-sm text-gray-500 mb-4">
          ¿Estás seguro de que querés cancelar la cita de{" "}
          <strong>{booking.customer_name || "este cliente"}</strong>?
        </p>
        <div className="mb-4">
          <label className="text-sm text-gray-600 block mb-1">
            Motivo (opcional)
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: Cliente no se presentó"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          />
        </div>
        <div className="flex gap-2">
          <Button
            variant="ghost"
            className="flex-1"
            onClick={onClose}
            disabled={isLoading}
          >
            Volver
          </Button>
          <Button
            className="flex-1 bg-red-600 text-white"
            disabled={isLoading}
            onClick={() => onSubmit({ reason: reason || undefined })}
          >
            {isLoading ? "Cancelando..." : "Cancelar cita"}
          </Button>
        </div>
      </div>
    </div>
  );
}
