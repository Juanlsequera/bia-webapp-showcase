import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { PublicProduct, CatalogResponse } from "@foodorder/types";
import { api } from "../../lib/api";
import { useTenant } from "../../lib/tenant";
import { BookingCalendar } from "../../components/booking/BookingCalendar";

// ─── Types internos ───────────────────────────────────────────────────────────
interface StaffMember {
  _id: string;
  name: string;
  avatar_url: string | null;
  bio?: string;
  rating?: number;
  services: string[];
}

interface TimeSlot {
  time: string;
  available: boolean;
  assignedStaffId?: string; // present when no staff preference was given
}

interface BookingFormState {
  step: 1 | 2 | 3 | 4 | 5;
  service: PublicProduct | null;
  staff: StaffMember | null;
  assignedStaffId: string | null; // resolved staffId when "sin preferencia"
  date: string | null; // YYYY-MM-DD
  time: string | null; // HH:MM
  customer: { name: string; phone: string; email: string; notes: string };
}

// ─── BookingFlowPage ──────────────────────────────────────────────────────────
/**
 * Flujo de reserva en 5 pasos:
 *   1 → Seleccionar servicio  (con hero del negocio)
 *   2 → Seleccionar profesional (si staff_management activo)
 *   3 → Seleccionar fecha (calendario) y hora
 *   4 → Datos del cliente
 *   5 → Confirmar + pago de seña
 */
export function BookingFlowPage() {
  const { tenantSlug, serviceId } = useParams<{
    tenantSlug: string;
    serviceId?: string;
  }>();
  const navigate = useNavigate();
  const tenant = useTenant();
  const hasStaff = !!tenant?.modules?.staff_management;
  const depositPct = tenant?.booking_settings?.deposit_pct ?? 0;
  const notifyEmail = tenant?.booking_settings?.notify_email ?? false;

  // Calendar month navigation state
  const now = new Date();
  const [calYear, setCalYear] = useState(now.getFullYear());
  const [calMonth, setCalMonth] = useState(now.getMonth() + 1);

  const [state, setState] = useState<BookingFormState>({
    step: serviceId ? 2 : 1,
    service: null,
    staff: null,
    assignedStaffId: null,
    date: null,
    time: null,
    customer: { name: "", phone: "", email: "", notes: "" },
  });

  const set = (patch: Partial<BookingFormState>) =>
    setState((s) => ({ ...s, ...patch }));

  const TOTAL_STEPS = 5;

  // ── Queries ─────────────────────────────────────────────────────────────────
  const { data: services = [] } = useQuery<PublicProduct[]>({
    queryKey: ["catalog", tenantSlug],
    queryFn: async () => {
      const res: CatalogResponse = (await api.get(`/${tenantSlug}/menu`)).data;
      return res.categories.flatMap((c) => c.items);
    },
    enabled: state.step === 1,
  });

  // Staff query — enabled always when service is selected and staff module is active.
  // NOT locked to step 2 so the cache is warm when the mutation needs it at step 5.
  const { data: staff = [] } = useQuery<StaffMember[]>({
    queryKey: ["staff", tenantSlug, state.service?._id],
    queryFn: async () =>
      (await api.get(`/${tenantSlug}/staff?serviceId=${state.service?._id}`))
        .data,
    enabled: hasStaff && !!state.service,
    staleTime: 5 * 60 * 1000,
  });

  // Calendar: fetch available days for the displayed month
  const { data: calendarData, isFetching: calendarLoading } = useQuery<{
    availableDates: string[];
  }>({
    queryKey: [
      "calendar",
      tenantSlug,
      calYear,
      calMonth,
      state.service?._id,
      state.staff?._id,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({
        month: `${calYear}-${String(calMonth).padStart(2, "0")}`,
      });
      if (state.service?._id) params.set("serviceId", state.service._id);
      if (state.staff?._id) params.set("staffId", state.staff._id);
      if (state.service?.duration_minutes)
        params.set("serviceDuration", String(state.service.duration_minutes));
      return (
        await api.get(
          `/${tenantSlug}/availability/calendar?${params.toString()}`,
        )
      ).data;
    },
    enabled: state.step === 3,
  });

  // Slots for selected date
  const { data: slots = [] } = useQuery<TimeSlot[]>({
    queryKey: [
      "slots",
      tenantSlug,
      state.service?._id,
      state.staff?._id,
      state.date,
    ],
    queryFn: async () => {
      const params = new URLSearchParams({ date: state.date! });
      if (state.service?._id) params.set("serviceId", state.service._id);
      if (state.staff?._id) params.set("staffId", state.staff._id);
      if (state.service?.duration_minutes)
        params.set("serviceDuration", String(state.service.duration_minutes));
      return (await api.get(`/${tenantSlug}/availability?${params.toString()}`))
        .data;
    },
    enabled: !!state.date && !!state.service && state.step === 3,
  });

  // ── Computed values ──────────────────────────────────────────────────────────
  const servicePrice = state.service?.price ?? 0;
  const depositAmount =
    depositPct > 0
      ? Math.round(((servicePrice * depositPct) / 100) * 100) / 100
      : 0;
  const balanceAmount = Math.round((servicePrice - depositAmount) * 100) / 100;

  // Effective staffId to use when creating the order
  const effectiveStaffId = state.staff?._id ?? state.assignedStaffId;

  // Bank accounts for PagoMóvil deposits
  const bankAccounts = (tenant?.bankAccounts ?? []).filter((b) => b.isActive);
  const hasPagomovil = bankAccounts.some((b) => b.bank); // any active account

  // ── Mutation ─────────────────────────────────────────────────────────────────
  const { mutate: createBooking, isPending: submitting } = useMutation({
    mutationFn: async (paymentMethod: "cash" | "pagomovil") => {
      const staffIdToUse = effectiveStaffId;

      if (!state.service || !state.date || !state.time || !staffIdToUse) {
        throw new Error("Datos incompletos");
      }
      const payload = {
        archetype: "booking",
        orderType: "takeaway",
        items: [
          {
            productId: state.service._id,
            quantity: 1,
            notes: state.customer.notes || undefined,
          },
        ],
        paymentMethod,
        customer_name: state.customer.name,
        customer_phone: state.customer.phone || undefined,
        customer_email: state.customer.email || undefined,
        bookingDatetime: `${state.date}T${state.time}:00.000Z`,
        staffId: staffIdToUse,
      };
      return (await api.post(`/${tenantSlug}/orders`, payload)).data;
    },
    onSuccess: (order, paymentMethod) => {
      if (paymentMethod === "pagomovil") {
        navigate(`/${tenantSlug}/orden/${order._id}/pagomovil`);
      } else {
        navigate(`/${tenantSlug}/reserva/${order._id}/confirmado`, {
          state: {
            order,
            service: state.service,
            staff: state.staff,
            date: state.date,
            time: state.time,
          },
        });
      }
    },
  });

  function handleSlotSelect(slot: TimeSlot) {
    if (!slot.available) return;
    set({
      time: slot.time,
      // Capture assignedStaffId from "no preference" slots
      assignedStaffId: slot.assignedStaffId ?? state.assignedStaffId,
    });
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 max-w-2xl mx-auto">
      {/* Hero — solo visible en step 1 */}
      {state.step === 1 && tenant && (
        <div
          className="px-6 py-8 text-center border-b"
          style={{
            background: `color-mix(in srgb, var(--color-primary, #111827) 12%, transparent)`,
            borderColor:
              "color-mix(in srgb, var(--color-primary, #111827) 25%, transparent)",
          }}
        >
          {/* Logo o iniciales */}
          <div
            className="mx-auto mb-3 w-16 h-16 rounded-full overflow-hidden flex items-center justify-center shadow-sm"
            style={{ backgroundColor: "var(--color-primary, #111827)" }}
          >
            {tenant.logo_url ? (
              <img
                src={tenant.logo_url}
                alt={tenant.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className="text-white font-bold text-xl">
                {tenant.name.slice(0, 2).toUpperCase()}
              </span>
            )}
          </div>
          <h2 className="text-lg font-bold text-gray-900">{tenant.name}</h2>
          <p
            className="text-sm mt-1"
            style={{ color: "var(--color-primary, #111827)" }}
          >
            {(tenant as any).config?.theme?.tagline ??
              tenant.theme?.tagline ??
              "Reservá tu cita online"}
          </p>
          <div className="flex items-center justify-center gap-4 mt-3 text-xs text-gray-500">
            <span>✂️ Servicios</span>
            <span>·</span>
            <span>⏱ Rápido</span>
            <span>·</span>
            <span>✅ Garantizado</span>
          </div>
        </div>
      )}

      {/* Header con progreso */}
      <header className="bg-white shadow-sm sticky top-0 z-10">
        <div className="max-w-lg mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() =>
              state.step > 1
                ? set({ step: (state.step - 1) as any })
                : navigate(-1)
            }
            className="text-gray-400 text-xl leading-none"
            aria-label="Atrás"
          >
            ←
          </button>
          <div>
            <h1 className="text-base font-bold text-gray-900">
              {state.step === 1 && "Elegí un servicio"}
              {state.step === 2 && "Elegí un profesional"}
              {state.step === 3 && "Fecha y hora"}
              {state.step === 4 && "Tus datos"}
              {state.step === 5 && "Confirmá tu reserva"}
            </h1>
            <p className="text-xs text-gray-400">
              Paso {state.step} de {TOTAL_STEPS}
            </p>
          </div>
        </div>
        <div className="h-0.5 bg-gray-100">
          <div
            className="h-full transition-all duration-300"
            style={{
              width: `${(state.step / TOTAL_STEPS) * 100}%`,
              backgroundColor: "var(--color-primary, #111827)",
            }}
          />
        </div>
      </header>

      <main className="max-w-lg mx-auto px-4 py-5">
        {/* ── PASO 1: Servicios ─────────────────────────────────────────────── */}
        {state.step === 1 && (
          <div className="space-y-3">
            {services
              .filter((s) => s.type === "service")
              .map((svc) => (
                <button
                  key={svc._id}
                  onClick={() => set({ service: svc, step: hasStaff ? 2 : 3 })}
                  className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 text-left hover:shadow-md transition-shadow border border-transparent hover:border-gray-100"
                >
                  <div className="w-14 h-14 rounded-full bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                    {svc.image_url ? (
                      <img
                        src={svc.image_url}
                        alt={svc.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl">✂️</span>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900">{svc.name}</p>
                    <p className="text-sm text-gray-500 mt-0.5 line-clamp-1">
                      {svc.description}
                    </p>
                    <div className="flex items-center gap-3 mt-1">
                      <span
                        className="text-sm font-bold"
                        style={{ color: "var(--color-primary)" }}
                      >
                        ${svc.price.toFixed(2)}
                      </span>
                      {svc.duration_minutes && (
                        <span className="text-xs text-gray-400">
                          · {svc.duration_minutes} min
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-gray-300 text-lg shrink-0">›</span>
                </button>
              ))}
            {services.length === 0 && (
              <p className="text-center text-gray-400 py-12 text-sm">
                No hay servicios disponibles
              </p>
            )}
          </div>
        )}

        {/* ── PASO 2: Staff ─────────────────────────────────────────────────── */}
        {state.step === 2 && (
          <div className="space-y-3">
            <ServiceSummaryChip service={state.service} />

            <button
              onClick={() =>
                set({ staff: null, assignedStaffId: null, step: 3 })
              }
              className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 border border-transparent hover:border-gray-100 transition-all"
            >
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center text-xl shrink-0">
                🎲
              </div>
              <div>
                <p className="font-semibold text-gray-900">Sin preferencia</p>
                <p className="text-xs text-gray-400">
                  Te asignamos el profesional disponible
                </p>
              </div>
            </button>

            {staff.map((member) => (
              <button
                key={member._id}
                onClick={() => set({ staff: member, step: 3 })}
                className="w-full bg-white rounded-xl shadow-sm p-4 flex items-center gap-4 border border-transparent hover:border-gray-100 transition-all text-left"
              >
                <div className="w-12 h-12 rounded-full bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
                  {member.avatar_url ? (
                    <img
                      src={member.avatar_url}
                      alt={member.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-lg">👤</span>
                  )}
                </div>
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{member.name}</p>
                  {member.bio && (
                    <p className="text-xs text-gray-400 line-clamp-1">
                      {member.bio}
                    </p>
                  )}
                  {member.rating && (
                    <p className="text-xs text-amber-500 mt-0.5">
                      ⭐ {member.rating.toFixed(1)}
                    </p>
                  )}
                </div>
                <span className="text-gray-300 text-lg shrink-0">›</span>
              </button>
            ))}
          </div>
        )}

        {/* ── PASO 3: Fecha (calendario) y hora ────────────────────────────── */}
        {state.step === 3 && (
          <div className="space-y-5">
            <ServiceSummaryChip service={state.service} staff={state.staff} />

            {/* Calendario visual */}
            <div className="bg-white rounded-xl shadow-sm p-4">
              <label className="text-xs text-gray-500 font-medium block mb-3">
                Seleccioná una fecha
              </label>
              <BookingCalendar
                year={calYear}
                month={calMonth}
                availableDates={calendarData?.availableDates ?? []}
                selectedDate={state.date}
                onDaySelect={(d) =>
                  set({ date: d, time: null, assignedStaffId: null })
                }
                onMonthChange={(y, m) => {
                  setCalYear(y);
                  setCalMonth(m);
                  set({ date: null, time: null });
                }}
                loading={calendarLoading}
              />
            </div>

            {/* Time slots */}
            {state.date && (
              <div>
                <label className="text-xs text-gray-500 font-medium block mb-2">
                  Horarios disponibles
                </label>
                {slots.length === 0 && (
                  <p className="text-sm text-gray-400 py-4 text-center">
                    No hay horarios disponibles para este día
                  </p>
                )}
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {slots.map((slot) => (
                    <button
                      key={slot.time}
                      disabled={!slot.available}
                      onClick={() => handleSlotSelect(slot)}
                      className={`py-2.5 rounded-lg text-sm font-medium transition-colors ${
                        state.time === slot.time
                          ? "text-white"
                          : slot.available
                            ? "bg-gray-50 text-gray-700 hover:bg-gray-100 border border-gray-200"
                            : "bg-gray-50 text-gray-300 border border-gray-100 cursor-not-allowed line-through"
                      }`}
                      style={
                        state.time === slot.time
                          ? { backgroundColor: "var(--color-primary)" }
                          : undefined
                      }
                    >
                      {slot.time}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {state.date && state.time && (
              <button
                onClick={() => set({ step: 4 })}
                className="w-full py-3.5 rounded-xl text-white font-semibold"
                style={{ backgroundColor: "var(--color-primary, #111827)" }}
              >
                Continuar →
              </button>
            )}
          </div>
        )}

        {/* ── PASO 4: Datos del cliente ──────────────────────────────────────── */}
        {state.step === 4 && (
          <div className="space-y-5">
            <ServiceSummaryChip
              service={state.service}
              staff={state.staff}
              date={state.date}
              time={state.time}
            />

            <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Tus datos
              </p>
              {(["name", "phone"] as const).map((field) => (
                <div key={field}>
                  <label
                    htmlFor={`booking-customer-${field}`}
                    className="text-xs text-gray-500 block mb-1"
                  >
                    {field === "name" ? "Nombre *" : "Teléfono *"}
                  </label>
                  <input
                    id={`booking-customer-${field}`}
                    value={state.customer[field]}
                    onChange={(e) =>
                      set({
                        customer: {
                          ...state.customer,
                          [field]: e.target.value,
                        },
                      })
                    }
                    placeholder={
                      field === "name" ? "María González" : "0414-1234567"
                    }
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>
              ))}
              {notifyEmail && (
                <div>
                  <label
                    htmlFor="booking-customer-email"
                    className="text-xs text-gray-500 block mb-1"
                  >
                    Email (para confirmación)
                  </label>
                  <input
                    id="booking-customer-email"
                    type="email"
                    value={state.customer.email}
                    onChange={(e) =>
                      set({
                        customer: { ...state.customer, email: e.target.value },
                      })
                    }
                    placeholder="tu@email.com"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
                  />
                </div>
              )}
              <div>
                <label
                  htmlFor="booking-customer-notes"
                  className="text-xs text-gray-500 block mb-1"
                >
                  Notas (opcional)
                </label>
                <textarea
                  id="booking-customer-notes"
                  value={state.customer.notes}
                  onChange={(e) =>
                    set({
                      customer: { ...state.customer, notes: e.target.value },
                    })
                  }
                  placeholder="Alguna indicación especial..."
                  rows={2}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm outline-none resize-none focus:ring-2 focus:ring-[var(--color-primary)]"
                />
              </div>
            </div>

            <button
              disabled={!state.customer.name || !state.customer.phone}
              onClick={() => set({ step: 5 })}
              className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-40 transition-opacity"
              style={{ backgroundColor: "var(--color-primary, #111827)" }}
            >
              Continuar →
            </button>
          </div>
        )}

        {/* ── PASO 5: Pago de seña ──────────────────────────────────────────── */}
        {state.step === 5 && (
          <div className="space-y-5">
            {/* Resumen */}
            <div className="bg-white rounded-xl shadow-sm p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Resumen de tu cita
              </p>
              <BookingSummaryRow
                icon="✂️"
                label="Servicio"
                value={state.service?.name ?? ""}
              />
              {state.staff && (
                <BookingSummaryRow
                  icon="👤"
                  label="Profesional"
                  value={state.staff.name}
                />
              )}
              <BookingSummaryRow
                icon="📅"
                label="Fecha y hora"
                value={`${formatDate(state.date!)} · ${state.time}`}
              />
              <BookingSummaryRow
                icon="⏱"
                label="Duración"
                value={
                  state.service?.duration_minutes
                    ? `${state.service.duration_minutes} min`
                    : "A confirmar"
                }
              />
              <div className="border-t border-gray-100 pt-3 space-y-1">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-600">
                    Total del servicio
                  </span>
                  <span className="text-sm font-medium text-gray-900">
                    ${servicePrice.toFixed(2)}
                  </span>
                </div>
                {depositPct > 0 && (
                  <>
                    <div className="flex justify-between">
                      <span
                        className="text-sm font-semibold"
                        style={{ color: "var(--color-primary)" }}
                      >
                        Seña ({depositPct}%) — pagás ahora
                      </span>
                      <span
                        className="text-sm font-bold"
                        style={{ color: "var(--color-primary)" }}
                      >
                        ${depositAmount.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between text-gray-400">
                      <span className="text-xs">Saldo al llegar</span>
                      <span className="text-xs">
                        ${balanceAmount.toFixed(2)}
                      </span>
                    </div>
                  </>
                )}
              </div>
            </div>

            {/* Métodos de pago o botón directo */}
            {depositPct === 0 ? (
              <button
                disabled={submitting}
                onClick={() => createBooking("cash")}
                className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-40 transition-opacity"
                style={{ backgroundColor: "var(--color-primary, #111827)" }}
              >
                {submitting
                  ? "Confirmando..."
                  : "✅ Confirmar reserva sin seña"}
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-semibold text-gray-700">
                  ¿Cómo pagás la seña?
                </p>

                {hasPagomovil && (
                  <button
                    disabled={submitting}
                    onClick={() => createBooking("pagomovil")}
                    className="w-full bg-white border border-gray-200 rounded-xl p-4 flex items-center gap-3 hover:border-gray-300 hover:shadow-sm transition-all disabled:opacity-40"
                  >
                    <span className="text-2xl">📱</span>
                    <div className="text-left">
                      <p className="font-semibold text-gray-900 text-sm">
                        PagoMóvil
                      </p>
                      <p className="text-xs text-gray-400">
                        Transferencia móvil inmediata
                      </p>
                    </div>
                    <span className="ml-auto text-gray-300">›</span>
                  </button>
                )}

                {!hasPagomovil && (
                  <button
                    disabled={submitting}
                    onClick={() => createBooking("cash")}
                    className="w-full py-3.5 rounded-xl text-white font-semibold disabled:opacity-40"
                    style={{ backgroundColor: "var(--color-primary, #111827)" }}
                  >
                    {submitting ? "Confirmando..." : "Confirmar reserva"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

// ─── Sub-componentes ──────────────────────────────────────────────────────────
function ServiceSummaryChip({
  service,
  staff,
  date,
  time,
}: {
  service: PublicProduct | null;
  staff?: StaffMember | null;
  date?: string | null;
  time?: string | null;
}) {
  if (!service) return null;
  return (
    <div className="bg-gray-50 rounded-xl px-4 py-3 flex items-center gap-3 border border-gray-100">
      <span className="text-lg">✂️</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900">{service.name}</p>
        {staff && <p className="text-xs text-gray-400">{staff.name}</p>}
        {date && time && (
          <p className="text-xs text-gray-400">
            {formatDate(date)} · {time}
          </p>
        )}
      </div>
      <span
        className="text-sm font-bold shrink-0"
        style={{ color: "var(--color-primary)" }}
      >
        ${service.price.toFixed(2)}
      </span>
    </div>
  );
}

function BookingSummaryRow({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-base w-5 text-center">{icon}</span>
      <span className="text-sm text-gray-500 w-24">{label}</span>
      <span className="text-sm font-medium text-gray-900">{value}</span>
    </div>
  );
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("es-VE", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}
