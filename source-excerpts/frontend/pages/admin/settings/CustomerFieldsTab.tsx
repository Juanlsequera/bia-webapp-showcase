import { useState, useCallback } from "react";
import { useTenantConfig } from "../../../hooks/useTenantConfig";

type FieldKey = "name" | "phone" | "email" | "address" | "dni" | "notes";

interface FieldConfig {
  enabled: boolean;
  required: boolean;
  label: string;
  askMap?: boolean;
}

const FIELD_DEFAULTS: Record<
  FieldKey,
  { defaultLabel: string; description: string }
> = {
  name: { defaultLabel: "Nombre", description: "Nombre del cliente" },
  phone: { defaultLabel: "Teléfono", description: "Número de teléfono" },
  email: { defaultLabel: "Email", description: "Correo electrónico" },
  address: { defaultLabel: "Dirección", description: "Dirección de entrega" },
  dni: { defaultLabel: "Cédula", description: "Documento de identidad" },
  notes: {
    defaultLabel: "Notas",
    description: "Instrucciones especiales del pedido",
  },
};

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed ${
        checked ? "bg-primary" : "bg-gray-300"
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

/**
 * Tab Datos del cliente — define qué campos se piden al cliente al hacer un pedido.
 * Cada fila tiene: habilitado, obligatorio, label override.
 */
export function CustomerFieldsTab() {
  const { config, update, isPending } = useTenantConfig();
  const customerFields = (config?.customerFields ?? {}) as Record<
    FieldKey,
    FieldConfig
  >;

  // Labels locales para edición con debounce manual
  const [localLabels, setLocalLabels] = useState<
    Partial<Record<FieldKey, string>>
  >({});

  const getField = (key: FieldKey): FieldConfig => {
    const saved = customerFields[key];
    return {
      enabled: saved?.enabled ?? false,
      required: saved?.required ?? false,
      label: saved?.label ?? FIELD_DEFAULTS[key].defaultLabel,
      askMap: saved?.askMap,
    };
  };

  const patchField = useCallback(
    (key: FieldKey, changes: Partial<FieldConfig>) => {
      update({
        customerFields: {
          [key]: { ...getField(key), ...changes },
        },
      } as Record<string, unknown>);
    },
    [config, update],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const handleLabelBlur = (key: FieldKey) => {
    const val = localLabels[key];
    if (val !== undefined && val !== getField(key).label) {
      patchField(key, { label: val || FIELD_DEFAULTS[key].defaultLabel });
    }
    setLocalLabels((prev) => {
      const n = { ...prev };
      delete n[key];
      return n;
    });
  };

  return (
    <div className="space-y-4" data-tour="settings-customer-fields">
      <section className="bg-surface border border-border rounded-2xl p-5">
        <div className="pb-3 border-b border-border mb-3">
          <h2 className="font-semibold text-app-text">Datos del cliente</h2>
          <p className="text-xs text-muted mt-1">
            Definí qué información se solicita al cliente al hacer un pedido.
            Los cambios se guardan automáticamente.
          </p>
        </div>

        <div className="space-y-1">
          {/* Header */}
          <div className="grid grid-cols-[1fr_auto_auto_160px] gap-3 pb-2 mb-1 border-b border-border">
            <span className="text-xs font-semibold text-muted">Campo</span>
            <span className="text-xs font-semibold text-muted w-16 text-center">
              Activo
            </span>
            <span className="text-xs font-semibold text-muted w-20 text-center">
              Obligatorio
            </span>
            <span className="text-xs font-semibold text-muted">Label</span>
          </div>

          {(Object.keys(FIELD_DEFAULTS) as FieldKey[]).map((key) => {
            const field = getField(key);
            const localLabel = localLabels[key] ?? field.label;

            return (
              <div
                key={key}
                className={`grid grid-cols-[1fr_auto_auto_160px] gap-3 items-center py-2.5 rounded-lg px-1 ${
                  field.enabled ? "" : "opacity-60"
                }`}
              >
                <div>
                  <p className="text-sm font-medium text-app-text">
                    {FIELD_DEFAULTS[key].description}
                  </p>
                </div>
                <div className="w-16 flex justify-center">
                  <Toggle
                    checked={field.enabled}
                    onChange={(v) =>
                      patchField(key, {
                        enabled: v,
                        required: v ? field.required : false,
                      })
                    }
                    disabled={isPending}
                  />
                </div>
                <div className="w-20 flex justify-center">
                  <Toggle
                    checked={field.required}
                    onChange={(v) => patchField(key, { required: v })}
                    disabled={!field.enabled || isPending}
                  />
                </div>
                <input
                  type="text"
                  value={localLabel}
                  disabled={!field.enabled}
                  onChange={(e) =>
                    setLocalLabels((prev) => ({
                      ...prev,
                      [key]: e.target.value,
                    }))
                  }
                  onBlur={() => handleLabelBlur(key)}
                  placeholder={FIELD_DEFAULTS[key].defaultLabel}
                  className="w-full border border-border rounded-lg px-2.5 py-1.5 text-sm bg-bg text-app-text focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-40 disabled:cursor-not-allowed"
                />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
