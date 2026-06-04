import { useState } from "react";
import { useTenantConfig } from "../../../hooks/useTenantConfig";
import { ConfigSwitch } from "../../../components/admin/ConfigSwitch";

/** Strings de la UI que el admin puede sobreescribir. */
const KNOWN_LABELS: Array<{
  key: string;
  defaultValue: string;
  description: string;
}> = [
  {
    key: "catalog.title",
    defaultValue: "Menú",
    description: "Título de la página de productos",
  },
  {
    key: "catalog.empty",
    defaultValue: "No hay productos",
    description: "Texto cuando el catálogo está vacío",
  },
  {
    key: "order.cta",
    defaultValue: "Confirmar pedido",
    description: "Botón principal del carrito",
  },
  {
    key: "order.itemNoun",
    defaultValue: "producto",
    description: "Sustantivo para un ítem (ej: servicio, plato)",
  },
  {
    key: "order.itemNounPlural",
    defaultValue: "productos",
    description: "Plural del sustantivo (ej: servicios, platos)",
  },
  {
    key: "staff.queue",
    defaultValue: "Cocina",
    description: "Nombre de la cola de pedidos en el KDS",
  },
  {
    key: "staff.ready",
    defaultValue: "Listo",
    description: 'Label del estado "listo para entregar"',
  },
  {
    key: "checkout.title",
    defaultValue: "Tu pedido",
    description: "Título de la pantalla de checkout",
  },
];

/**
 * Tab de textos y branding — override de labels.
 * Los colores, tipografía y bordes se manejan en /admin/apariencia.
 */
export function AppearanceTab() {
  const { config, update, isPending } = useTenantConfig();
  const labels = (config?.labels ?? {}) as Record<string, string>;
  const [localEdits, setLocalEdits] = useState<Record<string, string>>({});

  const handleBlur = (key: string, defaultValue: string) => {
    const val = localEdits[key];
    if (val === undefined) return;
    const next = val.trim() || defaultValue;
    update({ labels: { ...labels, [key]: next } } as Record<string, unknown>);
    setLocalEdits((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
  };

  const handleReset = (key: string) => {
    const next = { ...labels };
    delete next[key];
    update({ labels: next } as Record<string, unknown>);
    setLocalEdits((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
  };

  return (
    <div className="space-y-4">
      {/* Branding */}
      <section className="bg-surface border border-border rounded-2xl p-5 space-y-1">
        <div className="pb-3 border-b border-border mb-2">
          <h2 className="font-semibold text-app-text">Branding</h2>
        </div>
        <ConfigSwitch
          path="branding.showPoweredBy"
          label='Mostrar "Powered by FoodOrder"'
          description="Muestra el badge en el pie de la app del cliente"
        />
      </section>

      {/* Override de textos */}
      <section className="bg-surface border border-border rounded-2xl p-5">
        <div className="pb-3 border-b border-border mb-3">
          <h2 className="font-semibold text-app-text">Textos personalizados</h2>
          <p className="text-xs text-muted mt-1">
            Dejá el campo vacío para usar el texto predeterminado. Los cambios
            se guardan al salir del campo.
          </p>
        </div>

        <div className="space-y-3">
          {/* Header */}
          <div className="grid grid-cols-[1fr_200px_auto] gap-3 pb-1">
            <span className="text-xs font-semibold text-muted">
              Descripción
            </span>
            <span className="text-xs font-semibold text-muted">Texto</span>
            <span className="text-xs font-semibold text-muted w-12" />
          </div>

          {KNOWN_LABELS.map(({ key, defaultValue, description }) => {
            const savedValue = labels[key] ?? "";
            const displayValue = localEdits[key] ?? savedValue;
            const hasOverride =
              savedValue !== "" && savedValue !== defaultValue;

            return (
              <div
                key={key}
                className="grid grid-cols-[1fr_200px_auto] gap-3 items-center"
              >
                <div>
                  <p className="text-sm text-app-text">{description}</p>
                  <p className="text-xs text-muted font-mono">{defaultValue}</p>
                </div>
                <input
                  type="text"
                  value={displayValue}
                  placeholder={defaultValue}
                  disabled={isPending}
                  onChange={(e) =>
                    setLocalEdits((prev) => ({
                      ...prev,
                      [key]: e.target.value,
                    }))
                  }
                  onBlur={() => handleBlur(key, defaultValue)}
                  className="border border-border rounded-lg px-2.5 py-1.5 text-sm bg-bg text-app-text focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40 w-full"
                />
                {hasOverride ? (
                  <button
                    type="button"
                    onClick={() => handleReset(key)}
                    disabled={isPending}
                    className="w-12 text-xs text-muted hover:text-red-500 transition-colors disabled:opacity-40 text-center"
                    title="Restaurar predeterminado"
                  >
                    Reset
                  </button>
                ) : (
                  <div className="w-12" />
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
