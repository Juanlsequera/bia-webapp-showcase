import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  Wrench,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  Phone,
  User,
  FileText,
} from "lucide-react";
import type { PublicProduct, CatalogResponse } from "@foodorder/types";
import { api } from "../../lib/api";
import { useTenant } from "../../lib/tenant";
import { ClientLayout } from "../../components/layout/ClientLayout";
import { Button, Card, Skeleton, EmptyState } from "../../components/ui";
import { formatUsd } from "../../lib/money";

// ── tipos ─────────────────────────────────────────────────────────────────────

interface ServiceForm {
  step: 1 | 2 | 3;
  service: PublicProduct | null;
  customer: { name: string; phone: string; notes: string };
}

const EMPTY_FORM: ServiceForm = {
  step: 1,
  service: null,
  customer: { name: "", phone: "", notes: "" },
};

// ── api ───────────────────────────────────────────────────────────────────────

async function fetchLaborServices(
  tenantSlug: string,
): Promise<PublicProduct[]> {
  const res = await api.get<CatalogResponse>(`/${tenantSlug}/menu`);
  // Los productos de servicios pueden ser type='labor' (cotizable) o type='service' (servicio fijo).
  // El template de servicios crea con type='service'; ambos son válidos en este flujo.
  return res.data.categories
    .flatMap((c) => c.items)
    .filter((p) => p.type === "labor" || p.type === "service");
}

async function createServiceOrder(
  tenantSlug: string,
  service: PublicProduct,
  customer: ServiceForm["customer"],
) {
  const res = await api.post(`/${tenantSlug}/orders`, {
    archetype: "service",
    orderType: "takeaway",
    paymentMethod: "cash",
    customer_name: customer.name.trim(),
    customer_phone: customer.phone.trim() || undefined,
    items: [
      {
        productId: service._id,
        quantity: 1,
        notes: customer.notes.trim() || undefined,
      },
    ],
  });
  return res.data as { _id: string };
}

// ── page ──────────────────────────────────────────────────────────────────────

export function ServiceFlowPage() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const navigate = useNavigate();
  const tenant = useTenant();
  const [form, setForm] = useState<ServiceForm>(EMPTY_FORM);

  const {
    data: services,
    isLoading,
    isError,
  } = useQuery<PublicProduct[]>({
    queryKey: ["labor-services", tenantSlug],
    queryFn: () => fetchLaborServices(tenantSlug!),
    enabled: !!tenantSlug,
    staleTime: 5 * 60 * 1000,
  });

  const mutation = useMutation({
    mutationFn: () =>
      createServiceOrder(tenantSlug!, form.service!, form.customer),
    onSuccess: (order) => {
      navigate(`/${tenantSlug}/orden/${order._id}/estado`);
    },
  });

  const tenantName = (tenant as any)?.name ?? tenantSlug;

  // ── Step 1: elegir servicio ─────────────────────────────────────────────────

  if (form.step === 1) {
    return (
      <ClientLayout>
        <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
          <div className="text-center space-y-1">
            <div className="w-12 h-12 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
              <Wrench size={24} className="text-primary" />
            </div>
            <h1 className="text-xl font-bold text-app-text">{tenantName}</h1>
            <p className="text-muted text-sm">¿Qué servicio necesitás?</p>
          </div>

          {isLoading && (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 rounded-2xl" />
              ))}
            </div>
          )}

          {isError && (
            <EmptyState
              icon={Wrench}
              title="Error al cargar"
              description="No pudimos obtener los servicios disponibles."
            />
          )}

          {!isLoading && !isError && services?.length === 0 && (
            <EmptyState
              icon={Wrench}
              title="Sin servicios disponibles"
              description="Este negocio no tiene servicios habilitados en este momento."
            />
          )}

          {!isLoading && !isError && (services ?? []).length > 0 && (
            <div className="space-y-3">
              {(services ?? []).map((service) => (
                <button
                  key={service._id}
                  onClick={() => setForm((f) => ({ ...f, service, step: 2 }))}
                  className={`w-full text-left p-4 rounded-2xl border transition-all ${
                    form.service?._id === service._id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-surface hover:border-primary/50"
                  }`}
                >
                  <div className="flex justify-between items-start gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-app-text text-sm">
                        {service.name}
                      </p>
                      {service.description && (
                        <p className="text-muted text-xs mt-1 line-clamp-2">
                          {service.description}
                        </p>
                      )}
                      {service.duration_minutes && (
                        <p className="text-xs text-muted mt-1">
                          ⏱ {service.duration_minutes} min estimado
                        </p>
                      )}
                    </div>
                    <div className="text-right flex-shrink-0">
                      {service.price > 0 ? (
                        <p className="text-sm font-bold text-primary">
                          {formatUsd(service.price)}
                        </p>
                      ) : (
                        <p className="text-xs text-muted bg-border/40 rounded-full px-2 py-0.5">
                          Cotización
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </ClientLayout>
    );
  }

  // ── Step 2: datos del cliente ───────────────────────────────────────────────

  if (form.step === 2) {
    const canContinue = form.customer.name.trim().length >= 2;
    return (
      <ClientLayout>
        <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
          <button
            onClick={() => setForm((f) => ({ ...f, step: 1 }))}
            className="flex items-center gap-1 text-sm text-muted hover:text-app-text transition-colors"
          >
            <ArrowLeft size={16} /> Volver
          </button>

          <div className="space-y-1">
            <h2 className="text-xl font-bold text-app-text">Tus datos</h2>
            <p className="text-muted text-sm">
              Para que podamos contactarte con la cotización
            </p>
          </div>

          {/* Servicio seleccionado */}
          <Card className="flex items-center gap-3 py-3">
            <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <Wrench size={18} className="text-primary" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-app-text truncate">
                {form.service!.name}
              </p>
              {form.service!.price > 0 ? (
                <p className="text-xs text-muted">
                  {formatUsd(form.service!.price)}
                </p>
              ) : (
                <p className="text-xs text-muted">Precio por cotización</p>
              )}
            </div>
          </Card>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-app-text mb-1.5">
                <User size={14} className="inline mr-1" /> Nombre completo *
              </label>
              <input
                type="text"
                value={form.customer.name}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    customer: { ...f.customer, name: e.target.value },
                  }))
                }
                placeholder="Juan García"
                className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-app-text mb-1.5">
                <Phone size={14} className="inline mr-1" /> Teléfono (opcional)
              </label>
              <input
                type="tel"
                value={form.customer.phone}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    customer: { ...f.customer, phone: e.target.value },
                  }))
                }
                placeholder="0414-1234567"
                className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-app-text mb-1.5">
                <FileText size={14} className="inline mr-1" /> Descripción del
                trabajo (opcional)
              </label>
              <textarea
                value={form.customer.notes}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    customer: { ...f.customer, notes: e.target.value },
                  }))
                }
                placeholder="Describe qué necesitás: marca del equipo, síntomas, ubicación, etc."
                rows={4}
                className="w-full border border-border rounded-xl px-4 py-3 text-sm bg-bg text-app-text focus:outline-none focus:border-primary placeholder-muted resize-none"
              />
            </div>
          </div>

          <Button
            onClick={() => setForm((f) => ({ ...f, step: 3 }))}
            disabled={!canContinue}
            className="w-full"
          >
            Continuar <ArrowRight size={16} className="ml-1" />
          </Button>
        </div>
      </ClientLayout>
    );
  }

  // ── Step 3: confirmación ────────────────────────────────────────────────────

  return (
    <ClientLayout>
      <div className="max-w-lg mx-auto px-4 py-6 space-y-5">
        <button
          onClick={() => setForm((f) => ({ ...f, step: 2 }))}
          className="flex items-center gap-1 text-sm text-muted hover:text-app-text transition-colors"
        >
          <ArrowLeft size={16} /> Volver
        </button>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-app-text">
            Confirmá tu solicitud
          </h2>
          <p className="text-muted text-sm">Revisá los datos antes de enviar</p>
        </div>

        <Card className="space-y-3">
          <div className="flex items-center gap-3 pb-3 border-b border-border">
            <div className="w-9 h-9 bg-primary/10 rounded-xl flex items-center justify-center flex-shrink-0">
              <Wrench size={18} className="text-primary" />
            </div>
            <div>
              <p className="text-sm font-semibold text-app-text">
                {form.service!.name}
              </p>
              <p className="text-xs text-muted">
                {form.service!.price > 0
                  ? formatUsd(form.service!.price)
                  : "Precio por cotización"}
              </p>
            </div>
          </div>

          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Nombre</span>
              <span className="text-app-text font-medium">
                {form.customer.name}
              </span>
            </div>
            {form.customer.phone && (
              <div className="flex justify-between">
                <span className="text-muted">Teléfono</span>
                <span className="text-app-text">{form.customer.phone}</span>
              </div>
            )}
            {form.customer.notes && (
              <div>
                <p className="text-muted mb-1">Descripción</p>
                <p className="text-app-text text-xs bg-bg rounded-lg px-3 py-2">
                  {form.customer.notes}
                </p>
              </div>
            )}
          </div>
        </Card>

        <div className="bg-blue-50 text-blue-700 rounded-xl px-4 py-3 text-sm">
          Recibirás una cotización a la brevedad. Te contactaremos al número
          indicado.
        </div>

        <Button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
          className="w-full"
        >
          {mutation.isPending ? (
            "Enviando solicitud..."
          ) : (
            <>
              <CheckCircle2 size={16} className="mr-1" /> Enviar solicitud
            </>
          )}
        </Button>

        {mutation.isError && (
          <p className="text-center text-sm text-red-500">
            Error al enviar. Por favor intentá de nuevo.
          </p>
        )}
      </div>
    </ClientLayout>
  );
}
