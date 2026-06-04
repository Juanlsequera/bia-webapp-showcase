import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Copy, CheckCheck } from "lucide-react";
import {
  tenantsApi,
  authApi,
  tenantConfigApi,
  productsApi,
} from "../../lib/api";
import type { Product } from "@foodorder/types";
import { extractErrorMessage } from "../../lib/extract-error-message";
import { Button, Input, Skeleton } from "../../components/ui";
import { QrMesaGenerator } from "../../components/admin/QrMesaGenerator";
import { TeamSection } from "../../components/admin/TeamSection";
import { useTour } from "../../hooks/use-tour";
import { adminSettingsStepsByTab } from "../../lib/tours/admin-settings.tour";
import { useAuthStore } from "../../stores/auth.store";
import { useTenantPlan } from "../../hooks/useTenantPlan";
// M2 — tabs conectados al TenantConfig versionado
import { PaymentsTab } from "./settings/PaymentsTab";
import { ModulesTab } from "./settings/ModulesTab";

export function AdminSettingsPage() {
  const qc = useQueryClient();

  // Estado del horario — ahora parte de form para unificar guardado
  const DEFAULT_SCHEDULE = {
    openHour: 8,
    closeHour: 22,
    closedDays: [] as number[],
    timezone: "America/Caracas",
    forceOpen: false,
    forceClosed: false,
  };

  const [form, setForm] = useState({
    name: "",
    autoAcceptOrders: false,
    schedule: null as typeof DEFAULT_SCHEDULE | null,
    orderModes: { dine_in: true, takeaway: false, delivery: false },
    day_cutoff_hour: 0,
  });

  // M-6 · Referencia al estado inicial para detectar cambios
  const initialFormRef = useRef<typeof form | null>(null);

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const pwMismatch = pw.confirm.length > 0 && pw.next !== pw.confirm;
  const pwTooShort = pw.next.length > 0 && pw.next.length < 8;
  const pwCanSubmit =
    pw.current.length >= 1 && pw.next.length >= 8 && !pwMismatch;
  const { user: authUser } = useAuthStore();

  const { data: tenant, isLoading: loadingTenant } = useQuery({
    queryKey: ["tenant-me"],
    queryFn: tenantsApi.getMe,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (tenant) {
      const loaded = {
        name: tenant.name ?? "",
        autoAcceptOrders: tenant.autoAcceptOrders ?? false,
        schedule: tenant.schedule
          ? (() => {
              const { _id: _sid, ...schedData } =
                tenant.schedule as typeof DEFAULT_SCHEDULE & { _id?: unknown };
              return { ...DEFAULT_SCHEDULE, ...schedData };
            })()
          : null,
        orderModes: (tenant as any).orderModes ?? {
          dine_in: true,
          takeaway: false,
          delivery: false,
        },
        day_cutoff_hour: (tenant as any).day_cutoff_hour ?? 0,
      };
      setForm(loaded);
      // M-6 · Guardar estado inicial para detectar cambios
      if (!initialFormRef.current) initialFormRef.current = loaded;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant]);

  const update = useMutation({
    mutationFn: async () => {
      await tenantsApi.updateMe(form);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["tenant-me"] });
      toast.success("Cambios guardados");
      // M-6 · Actualizar el estado "guardado" de referencia
      initialFormRef.current = form;
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo guardar los cambios")),
  });

  // M-6 · Detectar cambios sin guardar
  const hasChanges =
    initialFormRef.current !== null &&
    JSON.stringify(form) !== JSON.stringify(initialFormRef.current);

  // M-6 · Bloquear navegación si hay cambios sin guardar (beforeunload compatible con BrowserRouter)
  useEffect(() => {
    if (!hasChanges) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasChanges]);

  // Hooks que deben estar siempre antes de cualquier early return.
  // Lee la pestaña activa de ?tab= para soportar deep-links (ej: el redirect
  // de /admin/apariencia → /admin/configuracion?tab=apariencia mantiene a la
  // gente que tenía bookmarks a la página standalone).
  const [searchParams] = useSearchParams();
  const VALID_TABS = [
    "negocio",
    "equipo",
    "pagos",
    "modulos",
    "reservas",
    "cuenta",
  ] as const;
  type TabId = (typeof VALID_TABS)[number];
  const initialTab: TabId = (() => {
    const t = searchParams.get("tab");
    return (VALID_TABS as readonly string[]).includes(t ?? "")
      ? (t as TabId)
      : "negocio";
  })();
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  // El tour de Settings tiene sub-tours por pestaña — los steps cambian
  // según la pestaña activa, pero el tourId queda fijo ('admin-settings')
  // para que el botón "Tour de ayuda" del sidebar y el sistema de
  // markCompleted/isSeen sigan funcionando con un solo identificador.
  // El sidebar dispara 'tour:restart' → useTour lo escucha y lanza el sub-tour
  // de la pestaña activa. No hace falta exponer start() acá.
  useTour("admin-settings", adminSettingsStepsByTab[activeTab]);
  const { plan } = useTenantPlan();

  const changePw = useMutation({
    mutationFn: async () => {
      await authApi.changePassword(pw.current, pw.next);
    },
    onSuccess: () => {
      setPw({ current: "", next: "", confirm: "" });
      toast.success("Contraseña actualizada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "Contraseña actual incorrecta")),
  });

  const set = (path: string, value: string) => {
    setForm((prev) => {
      const parts = path.split(".");
      if (parts.length === 1) return { ...prev, [path]: value };
      if (parts.length === 2) {
        const [parent, child] = parts;
        return {
          ...prev,
          [parent]: {
            ...(prev[parent as keyof typeof prev] as object),
            [child]: value,
          },
        };
      }
      return prev;
    });
  };

  // Helpers de arquetipo — disponibles después del early-return de loading
  const isFood = tenant?.business_types?.includes("food") ?? false;
  const isRetail = tenant?.business_types?.includes("retail") ?? false;
  const isService = tenant?.business_types?.includes("service") ?? false;
  const isBooking = tenant?.business_types?.includes("booking") ?? false;

  if (loadingTenant) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-48" />
        </div>
        {[120, 160, 200, 100].map((h, i) => (
          <Skeleton
            key={i}
            className="rounded-2xl w-full"
            style={{ height: h }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-slide-up">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold text-app-text">Configuración</h1>
            <PlanBadge plan={plan} />
          </div>
          <p className="text-sm text-muted">Datos del negocio y preferencias</p>
        </div>
        {hasChanges && activeTab === "negocio" && (
          <span className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-full flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            Cambios sin guardar
          </span>
        )}
      </div>

      {/* Pestañas — orden 2026-05-25: Negocio → Equipo (alta empleados, frecuente
          post-onboarding) → Pagos (cuentas + métodos juntos) → Catálogo → Cliente
          → Módulos (features avanzadas) → Apariencia (se mueve acá tras quitar
          la página standalone del sidebar) */}
      <div className="flex gap-1 bg-bg border border-border rounded-xl p-1 flex-wrap">
        {(
          [
            { id: "negocio", label: "Negocio" },
            { id: "equipo", label: "Equipo" },
            { id: "pagos", label: "Pagos" },
            { id: "modulos", label: "Módulos" },
            { id: "reservas", label: "Reservas" },
            { id: "cuenta", label: "Cuenta" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-semibold transition-all whitespace-nowrap ${
              activeTab === tab.id
                ? "bg-surface shadow-sm text-primary border border-border"
                : "text-muted hover:text-app-text"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── Pestaña Negocio ── */}
      {activeTab === "negocio" && (
        <>
          {/* Info básica */}
          <section
            data-tour="settings-business-info"
            className="bg-surface border border-border rounded-2xl p-5 space-y-4"
          >
            <h2 className="font-semibold text-app-text">
              Información del negocio
            </h2>
            <Input
              label="Nombre del negocio"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </section>

          {/* Cuentas bancarias — movidas a la pestaña Pagos (2026-05-25) para unificar
          todo lo de cobro en un solo lugar. Dejar el ancla del tour acá vacía
          rompería el step; el tour de settings ahora apunta a Pagos. */}

          {/* QRs de mesas — solo aplica al arquetipo food. Un salón de belleza,
          un servicio técnico o un comercio retail no usan mesas. */}
          {tenant?.business_types?.includes("food") && (
            <div data-tour="settings-table-qr">
              <QrMesaGenerator
                tenantName={tenant?.name ?? "Mi Negocio"}
                tenantLogo={tenant?.logo_url ?? null}
              />
            </div>
          )}

          {/* Auto-accept orders toggle — solo food / retail */}
          {(isFood || isRetail) && (
            <section className="bg-surface border border-border rounded-2xl p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-app-text">
                    Aceptar pedidos automáticamente
                  </h2>
                  <p className="text-xs text-muted mt-1">
                    Las órdenes pagadas pasan directo a "preparando" sin que
                    cocina toque "Tomar pedido"
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.autoAcceptOrders}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      autoAcceptOrders: !f.autoAcceptOrders,
                    }))
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                    form.autoAcceptOrders ? "bg-primary" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                      form.autoAcceptOrders ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>
            </section>
          )}

          {/* ── Modos de pedido — solo food ─────────────────────────────── */}
          {isFood && (
            <section
              data-tour="settings-order-modes"
              className="bg-surface border border-border rounded-2xl p-5 space-y-4"
            >
              <div>
                <h2 className="font-semibold text-app-text">Modos de pedido</h2>
                <p className="text-xs text-muted mt-1">
                  Elegí qué tipo de pedidos acepta tu negocio.
                </p>
              </div>
              <div className="space-y-3">
                {(
                  [
                    {
                      key: "dine_in",
                      label: "🪑 En mesa",
                      desc: "Clientes escanean el QR de su mesa",
                      disabled: false,
                    },
                    {
                      key: "takeaway",
                      label: "🥡 Para llevar",
                      desc: "Pedidos para retirar en mostrador",
                      disabled: false,
                    },
                    {
                      key: "delivery",
                      label: "🛵 Delivery",
                      desc: "A domicilio — próximamente",
                      disabled: true,
                    },
                  ] as const
                ).map(({ key, label, desc, disabled }) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4"
                  >
                    <div className={disabled ? "opacity-40" : ""}>
                      <p className="text-sm font-medium text-app-text">
                        {label}
                      </p>
                      <p className="text-xs text-muted">{desc}</p>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={form.orderModes[key]}
                      disabled={disabled}
                      onClick={() => {
                        if (disabled) return;
                        const next = {
                          ...form.orderModes,
                          [key]: !form.orderModes[key],
                        };
                        const anyActive =
                          next.dine_in || next.takeaway || next.delivery;
                        if (!anyActive) {
                          toast.error("Al menos un modo debe estar activo.");
                          return;
                        }
                        setForm((f) => ({ ...f, orderModes: next }));
                      }}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-40 ${
                        form.orderModes[key] ? "bg-primary" : "bg-gray-300"
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${form.orderModes[key] ? "translate-x-5" : "translate-x-0"}`}
                      />
                    </button>
                  </div>
                ))}
              </div>
              {form.orderModes.takeaway && tenant && (
                <TakeawayLinkBox slug={(tenant as any).slug} />
              )}
              <button
                type="button"
                onClick={() => update.mutate()}
                disabled={update.isPending}
                className="px-4 py-2 bg-primary text-white text-sm font-semibold rounded-xl hover:bg-primary/90 disabled:opacity-60 transition-colors"
              >
                {update.isPending ? "Guardando…" : "Guardar modos"}
              </button>
            </section>
          )}

          {/* ── Horario de atención — food / retail / booking (no service) ── */}
          {!isService && (
            <section
              data-tour="settings-schedule"
              className="bg-surface border border-border rounded-2xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h2 className="font-semibold text-app-text">
                    Horario de atención
                  </h2>
                  <p className="text-xs text-muted mt-1">
                    {form.schedule !== null
                      ? "El menú bloquea pedidos fuera del horario configurado."
                      : "Sin horario configurado — el negocio acepta pedidos en cualquier momento."}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.schedule !== null}
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      schedule:
                        f.schedule !== null ? null : { ...DEFAULT_SCHEDULE },
                    }))
                  }
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
                    form.schedule !== null ? "bg-primary" : "bg-gray-300"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${form.schedule !== null ? "translate-x-5" : "translate-x-0"}`}
                  />
                </button>
              </div>

              {form.schedule !== null && (
                <div className="space-y-4 pt-2 border-t border-border">
                  {/* Overrides manuales */}
                  <div className="flex gap-2">
                    <button
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          schedule: f.schedule
                            ? {
                                ...f.schedule,
                                forceOpen: !f.schedule.forceOpen,
                                forceClosed: false,
                              }
                            : null,
                        }))
                      }
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                        form.schedule?.forceOpen
                          ? "bg-secondary/10 border-secondary text-secondary"
                          : "border-border text-muted hover:border-secondary hover:text-secondary"
                      }`}
                    >
                      {form.schedule?.forceOpen
                        ? "✓ Abierto ahora"
                        : "Forzar abierto"}
                    </button>
                    <button
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          schedule: f.schedule
                            ? {
                                ...f.schedule,
                                forceClosed: !f.schedule.forceClosed,
                                forceOpen: false,
                              }
                            : null,
                        }))
                      }
                      className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-colors ${
                        form.schedule?.forceClosed
                          ? "bg-red-50 border-red-400 text-red-600"
                          : "border-border text-muted hover:border-red-400 hover:text-red-500"
                      }`}
                    >
                      {form.schedule?.forceClosed
                        ? "✓ Cerrado ahora"
                        : "Forzar cerrado"}
                    </button>
                  </div>

                  {/* Horas */}
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-muted block mb-1">
                        Abre a las
                      </label>
                      <select
                        value={form.schedule?.openHour ?? 8}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            schedule: f.schedule
                              ? {
                                  ...f.schedule,
                                  openHour: Number(e.target.value),
                                }
                              : null,
                          }))
                        }
                        className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, "0")}:00
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted block mb-1">
                        Cierra a las
                      </label>
                      <select
                        value={form.schedule?.closeHour ?? 22}
                        onChange={(e) =>
                          setForm((f) => ({
                            ...f,
                            schedule: f.schedule
                              ? {
                                  ...f.schedule,
                                  closeHour: Number(e.target.value),
                                }
                              : null,
                          }))
                        }
                        className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
                      >
                        {Array.from({ length: 24 }, (_, h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, "0")}:00
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Días de atención */}
                  <div>
                    <label className="text-xs font-medium text-muted block mb-2">
                      Días de atención
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map(
                        (day, i) => {
                          const closed = (
                            form.schedule?.closedDays ?? []
                          ).includes(i);
                          const open = !closed;
                          return (
                            <button
                              key={i}
                              onClick={() =>
                                setForm((f) => ({
                                  ...f,
                                  schedule: f.schedule
                                    ? {
                                        ...f.schedule,
                                        closedDays: closed
                                          ? f.schedule.closedDays.filter(
                                              (d) => d !== i,
                                            )
                                          : [...f.schedule.closedDays, i],
                                      }
                                    : null,
                                }))
                              }
                              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                                open
                                  ? "bg-emerald-50 border-emerald-400 text-emerald-700"
                                  : "border-border text-muted bg-white hover:border-gray-400"
                              }`}
                            >
                              {day}
                            </button>
                          );
                        },
                      )}
                    </div>
                    <p className="text-xs text-muted mt-1">
                      Seleccioná los días en que abrís tu negocio.
                    </p>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* ── Link de reservas — solo booking ──────────────────────────── */}
          {isBooking && tenant && (
            <section className="bg-surface border border-border rounded-2xl p-5 space-y-3">
              <div>
                <h2 className="font-semibold text-app-text">
                  Link de reservas para clientes
                </h2>
                <p className="text-xs text-muted mt-1">
                  Compartí este link para que tus clientes reserven turnos
                  online.
                </p>
              </div>
              <BookingLinkBox slug={(tenant as any).slug} />
            </section>
          )}

          {/* ── Corte de día de negocio — solo food ─────────────────────── */}
          {isFood && (
            <section className="bg-surface border border-border rounded-2xl p-5 space-y-4">
              <div>
                <h2 className="font-semibold text-app-text">
                  Corte del día de negocio
                </h2>
                <p className="text-xs text-muted mt-1">
                  Hora a partir de la cual empieza un nuevo día de pedidos. Si
                  tu negocio opera de madrugada (ej. bar hasta las 4 AM), los
                  pedidos de esas horas seguirán contando para el día anterior.
                </p>
              </div>
              <div>
                <label className="text-xs font-medium text-muted block mb-1">
                  Hora de corte
                </label>
                <select
                  value={form.day_cutoff_hour}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      day_cutoff_hour: Number(e.target.value),
                    }))
                  }
                  className="w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-bg text-app-text focus:outline-none focus:border-primary"
                >
                  <option value={0}>00:00 — sin ajuste (estándar)</option>
                  {[1, 2, 3, 4, 5, 6].map((h) => (
                    <option key={h} value={h}>
                      {String(h).padStart(2, "0")}:00 AM — pedidos hasta las{" "}
                      {String(h).padStart(2, "0")}:00 cuentan para el día
                      anterior
                    </option>
                  ))}
                </select>
                {form.day_cutoff_hour > 0 && (
                  <p className="text-xs text-amber-600 mt-1.5">
                    Los pedidos creados entre medianoche y las{" "}
                    {String(form.day_cutoff_hour).padStart(2, "0")}:00 AM se
                    numerarán dentro del día anterior.
                  </p>
                )}
              </div>
            </section>
          )}

          {/* ── Upsell "¿Lo hacés combo?" — solo food ─────────────────────────── */}
          {isFood && <UpsellSection />}

          <div className="flex items-center gap-3">
            <Button
              className="flex-1"
              loading={update.isPending}
              onClick={() => update.mutate()}
            >
              Guardar cambios
            </Button>
          </div>

          {/* fin pestaña Negocio */}
        </>
      )}

      {/* ── Pestañas TenantConfig versionado ── */}
      {activeTab === "pagos" && <PaymentsTab />}

      {/* ── Pestaña Módulos — toggles archetype-aware del TenantConfig ── */}
      {activeTab === "modulos" && <ModulesTab />}

      {/* ── Pestaña Reservas — configuración de seña para booking ── */}
      {activeTab === "reservas" && <BookingSettingsTab />}

      {/* ── Pestaña Equipo y seguridad ── */}
      {activeTab === "equipo" && (
        <div data-tour="settings-team">
          <TeamSection />
        </div>
      )}

      {/* ── Pestaña Cuenta — datos del admin logueado + cambio de contraseña ── */}
      {activeTab === "cuenta" && (
        <div className="space-y-4" data-tour="settings-account">
          {/* Datos del admin actual */}
          <section className="bg-surface border border-border rounded-2xl p-5 space-y-3">
            <div>
              <h2 className="font-semibold text-app-text">Mi cuenta</h2>
              <p className="text-xs text-muted mt-1">
                Datos del admin actualmente logueado. Para cambiar el correo o
                crear más admins contactá soporte.
              </p>
            </div>
            <div className="space-y-2 pt-2 border-t border-border">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted">Correo</span>
                <span className="text-sm font-medium text-app-text font-mono break-all">
                  {authUser?.email ?? "—"}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm text-muted">Rol</span>
                <span className="text-sm font-medium text-app-text capitalize">
                  {authUser?.role ?? "—"}
                </span>
              </div>
            </div>
          </section>

          {/* Cambio de contraseña */}
          <section
            className="bg-surface border border-border rounded-2xl p-5 space-y-4"
            data-tour="settings-password"
          >
            <div>
              <h2 className="font-semibold text-app-text">
                Cambiar contraseña
              </h2>
              <p className="text-xs text-muted mt-1">
                Necesitás tu contraseña actual. La nueva debe tener al menos 8
                caracteres.
              </p>
            </div>
            <div className="space-y-3">
              <Input
                label="Contraseña actual *"
                type="password"
                autoComplete="current-password"
                value={pw.current}
                onChange={(e) =>
                  setPw((p) => ({ ...p, current: e.target.value }))
                }
              />
              <Input
                label="Contraseña nueva *"
                type="password"
                autoComplete="new-password"
                value={pw.next}
                onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))}
                error={pwTooShort ? "Mínimo 8 caracteres" : undefined}
              />
              <Input
                label="Confirmar contraseña nueva *"
                type="password"
                autoComplete="new-password"
                value={pw.confirm}
                onChange={(e) =>
                  setPw((p) => ({ ...p, confirm: e.target.value }))
                }
                error={pwMismatch ? "Las contraseñas no coinciden" : undefined}
              />
              <Button
                className="w-full"
                disabled={!pwCanSubmit}
                loading={changePw.isPending}
                onClick={() => changePw.mutate()}
              >
                Actualizar contraseña
              </Button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function TakeawayLinkBox({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/${slug}/llevar`;

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-1.5">
      <p className="text-xs font-semibold text-primary">
        Link para pedidos para llevar
      </p>
      <p className="text-xs text-muted">
        Compartí este link con tus clientes para que pidan desde su celular.
      </p>
      <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2">
        <span className="flex-1 text-xs text-app-text font-mono truncate">
          {url}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

function BookingLinkBox({ slug }: { slug: string }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/${slug}/reservar`;

  const handleCopy = () => {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-1.5">
      <p className="text-xs font-semibold text-primary">
        Link de reservas online
      </p>
      <p className="text-xs text-muted">
        Compartí este link con tus clientes para que reserven su turno desde el
        celular.
      </p>
      <div className="flex items-center gap-2 bg-surface border border-border rounded-lg px-3 py-2">
        <span className="flex-1 text-xs text-app-text font-mono truncate">
          {url}
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition-colors"
        >
          {copied ? <CheckCheck size={14} /> : <Copy size={14} />}
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

// ── Badge de plan ─────────────────────────────────────────────────────────────

const PLAN_COLORS: Record<string, { bg: string; text: string; label: string }> =
  {
    starter: { bg: "bg-[#511A8118]", text: "text-[#511A81]", label: "Starter" },
    pro: { bg: "bg-sky-100", text: "text-sky-700", label: "Pro" },
    enterprise: {
      bg: "bg-amber-100",
      text: "text-amber-700",
      label: "Enterprise",
    },
  };

function PlanBadge({ plan }: { plan: string }) {
  const style = PLAN_COLORS[plan] ?? PLAN_COLORS.starter;
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${style.bg} ${style.text}`}
    >
      {style.label}
    </span>
  );
}

// ── Sección Upsell ────────────────────────────────────────────────────────────

function UpsellSection() {
  const qc = useQueryClient();

  const { data: tenant } = useQuery({
    queryKey: ["tenant-me"],
    queryFn: tenantsApi.getMe,
    staleTime: 5 * 60 * 1000,
  });

  const { data: products = [] } = useQuery<Product[]>({
    queryKey: ["admin-products"],
    queryFn: productsApi.list,
    staleTime: 5 * 60 * 1000,
  });

  const [enabled, setEnabled] = useState(false);
  const [addOnIds, setAddOnIds] = useState<string[]>([]);
  const [bundlePrice, setBundlePrice] = useState("");

  // Poblar desde tenant cuando carga
  useEffect(() => {
    if (tenant) {
      const u = (tenant as any).upsell ?? {};
      setEnabled(u.enabled ?? false);
      setAddOnIds(u.addOnProductIds ?? []);
      setBundlePrice(
        u.bundleExtraPrice != null ? String(u.bundleExtraPrice) : "",
      );
    }
  }, [tenant]);

  const save = useMutation({
    mutationFn: async () => {
      const price = parseFloat(bundlePrice);
      return tenantsApi.updateUpsell({
        enabled,
        addOnProductIds: addOnIds,
        bundleExtraPrice: isNaN(price) ? 0 : price,
      });
    },
    onSuccess: () => {
      toast.success("Configuración de upsell guardada");
      qc.invalidateQueries({ queryKey: ["tenant-me"] });
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "Error al guardar upsell")),
  });

  const activeProducts = products.filter((p) => p.active);
  const selectedProducts = activeProducts.filter((p) =>
    addOnIds.includes(p._id),
  );
  const bundlePriceNum = parseFloat(bundlePrice);
  const totalAddOnPrice = selectedProducts.reduce((s, p) => s + p.price, 0);
  const savings =
    !isNaN(bundlePriceNum) && bundlePriceNum > 0
      ? totalAddOnPrice - bundlePriceNum
      : null;

  return (
    <section className="bg-surface border border-border rounded-2xl p-5 space-y-4">
      {/* Encabezado + toggle */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="font-semibold text-app-text">
            Upsell "¿Lo hacés combo?"
          </h2>
          <p className="text-xs text-muted mt-1">
            Al agregar un producto al carrito, el cliente ve una oferta para
            sumarle add-ons por un precio especial.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          onClick={() => setEnabled((v) => !v)}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 ${
            enabled ? "bg-primary" : "bg-gray-300"
          }`}
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${
              enabled ? "translate-x-5" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      {enabled && (
        <div className="space-y-4 pt-2 border-t border-border">
          {/* Selector de add-ons */}
          <div>
            <label className="text-sm font-medium text-app-text block mb-1">
              Productos add-on
            </label>
            <p className="text-xs text-muted mb-2">
              Elegí qué productos se ofrecen como complemento (papas fritas,
              bebida, postre, etc.).
            </p>
            {activeProducts.length === 0 ? (
              <p className="text-xs text-muted italic">
                No hay productos activos todavía.
              </p>
            ) : (
              <div className="space-y-0.5 max-h-48 overflow-y-auto border border-border rounded-xl p-2">
                {activeProducts.map((p) => {
                  const checked = addOnIds.includes(p._id);
                  return (
                    <label
                      key={p._id}
                      className={`flex items-center gap-2.5 px-2 py-1.5 rounded-lg cursor-pointer transition-colors ${
                        checked ? "bg-primary/5" : "hover:bg-bg"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setAddOnIds((ids) =>
                            checked
                              ? ids.filter((id) => id !== p._id)
                              : [...ids, p._id],
                          )
                        }
                        className="rounded accent-primary"
                      />
                      <span className="flex-1 text-sm text-app-text truncate">
                        {p.name}
                      </span>
                      <span className="text-xs text-muted flex-shrink-0">
                        ${p.price.toFixed(2)}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Precio extra del bundle */}
          <div>
            <label className="text-sm font-medium text-app-text block mb-1">
              Precio extra del combo (USD)
            </label>
            <p className="text-xs text-muted mb-1.5">
              Cuánto paga el cliente <em>adicional</em> al precio base del
              producto principal para sumar todos los add-ons.
            </p>
            <input
              type="number"
              min="0"
              step="0.01"
              value={bundlePrice}
              onChange={(e) => setBundlePrice(e.target.value)}
              placeholder="ej: 2.50"
              className="w-full border border-border rounded-xl px-3 py-2 text-sm bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
            />
          </div>

          {/* Vista previa */}
          {selectedProducts.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-xl p-3 space-y-1.5">
              <p className="text-xs font-bold text-green-800 uppercase tracking-wide">
                Vista previa del cliente
              </p>
              <p className="text-sm text-gray-700">
                Al agregar un producto elegible el cliente verá:{" "}
                <strong>
                  «¿Lo hacés combo? Sumale{" "}
                  {selectedProducts.map((p) => p.name).join(", ")}
                  {!isNaN(bundlePriceNum) && bundlePriceNum > 0
                    ? ` por $${bundlePriceNum.toFixed(2)} más.»`
                    : " incluido.»"}
                </strong>
              </p>
              {savings != null && savings > 0 && (
                <p className="text-xs text-green-700">
                  El cliente ahorra <strong>${savings.toFixed(2)}</strong>{" "}
                  respecto a pedir cada add-on por separado.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <Button
        onClick={() => save.mutate()}
        loading={save.isPending}
        disabled={save.isPending}
      >
        Guardar upsell
      </Button>
    </section>
  );
}

// ── Pestaña Reservas ──────────────────────────────────────────────────────────

const DEPOSIT_PRESETS: ReadonlyArray<{
  readonly value: number;
  readonly label: string;
  readonly description: string;
  readonly recommended?: boolean;
}> = [
  {
    value: 0,
    label: "Sin seña",
    description: "El cliente no paga al reservar",
  },
  { value: 25, label: "25%", description: "Seña parcial baja" },
  {
    value: 50,
    label: "50%",
    description: "Seña parcial estándar",
    recommended: true,
  },
  { value: 100, label: "100%", description: "Pago completo al reservar" },
];

function BookingSettingsTab() {
  const qc = useQueryClient();

  // Fetch effective config to get current booking_settings
  const { data: config, isLoading } = useQuery<Record<string, any>>({
    queryKey: ["tenant-me-config"],
    queryFn: () => tenantConfigApi.getMine(),
  });

  const currentPct: number =
    (config as any)?.booking_settings?.deposit_pct ?? 0;

  const [selectedPct, setSelectedPct] = useState<number>(currentPct);
  const [customPct, setCustomPct] = useState<string>("");
  const [useCustom, setUseCustom] = useState(false);

  // Sync when config loads
  useEffect(() => {
    const pct = (config as any)?.booking_settings?.deposit_pct ?? 0;
    const isPreset = DEPOSIT_PRESETS.some((p) => p.value === pct);
    setSelectedPct(pct);
    if (!isPreset && pct > 0) {
      setUseCustom(true);
      setCustomPct(String(pct));
    }
  }, [config]);

  const effectivePct = useCustom ? parseInt(customPct, 10) || 0 : selectedPct;

  const save = useMutation({
    mutationFn: async () => {
      const pct = Math.min(100, Math.max(0, effectivePct));
      return tenantConfigApi.update({ booking_settings: { deposit_pct: pct } });
    },
    onSuccess: () => {
      toast.success("Configuración de reservas guardada");
      qc.invalidateQueries({ queryKey: ["tenant-me-config"] });
    },
    onError: (err) => {
      toast.error(extractErrorMessage(err, "Error al guardar"));
    },
  });

  // Example: assume $20 service
  const examplePrice = 20;
  const depositEx =
    effectivePct > 0
      ? Math.round(((examplePrice * effectivePct) / 100) * 100) / 100
      : 0;
  const balanceEx = examplePrice - depositEx;

  if (isLoading)
    return (
      <div className="py-12 text-center text-sm text-muted">Cargando...</div>
    );

  return (
    <section className="bg-surface border border-border rounded-2xl p-5 space-y-5">
      <div>
        <h2 className="font-semibold text-app-text">
          Configuración de reservas
        </h2>
        <p className="text-sm text-muted mt-1">
          Definí cuánto paga el cliente al reservar para garantizar su cita.
        </p>
      </div>

      <div className="space-y-2">
        <p className="text-sm font-medium text-app-text">
          ¿Cuánto cobrar para confirmar la cita?
        </p>

        {DEPOSIT_PRESETS.map((preset) => (
          <label
            key={preset.value}
            className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
              !useCustom && selectedPct === preset.value
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <input
              type="radio"
              name="deposit"
              checked={!useCustom && selectedPct === preset.value}
              onChange={() => {
                setSelectedPct(preset.value);
                setUseCustom(false);
              }}
              className="text-primary"
            />
            <div className="flex-1">
              <span className="text-sm font-medium text-app-text">
                {preset.label}
              </span>
              {preset.recommended && (
                <span className="ml-2 text-[10px] font-bold uppercase text-primary bg-primary/10 px-1.5 py-0.5 rounded-full">
                  Recomendado
                </span>
              )}
              <p className="text-xs text-muted">{preset.description}</p>
            </div>
          </label>
        ))}

        {/* Custom */}
        <label
          className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
            useCustom
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40"
          }`}
        >
          <input
            type="radio"
            name="deposit"
            checked={useCustom}
            onChange={() => setUseCustom(true)}
            className="mt-0.5 text-primary"
          />
          <div className="flex-1 flex items-center gap-2">
            <span className="text-sm font-medium text-app-text">Otro:</span>
            <input
              type="number"
              min={1}
              max={100}
              value={customPct}
              onChange={(e) => {
                setCustomPct(e.target.value);
                setUseCustom(true);
              }}
              placeholder="ej. 30"
              className="w-20 border border-border rounded-lg px-2 py-1 text-sm text-center outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-sm text-muted">%</span>
          </div>
        </label>
      </div>

      {/* Ejemplo */}
      {effectivePct > 0 && (
        <div className="bg-bg border border-border rounded-xl p-3 text-sm text-muted space-y-1">
          <p className="font-medium text-app-text text-xs uppercase tracking-wide">
            Ejemplo con servicio de ${examplePrice}
          </p>
          <p>
            El cliente paga{" "}
            <strong className="text-primary">${depositEx.toFixed(2)}</strong> al
            reservar
          </p>
          <p>
            y <strong>${balanceEx.toFixed(2)}</strong> al llegar
          </p>
        </div>
      )}

      <Button
        onClick={() => save.mutate()}
        loading={save.isPending}
        disabled={save.isPending}
      >
        Guardar
      </Button>
    </section>
  );
}
