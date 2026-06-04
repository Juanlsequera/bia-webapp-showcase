import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Star, Check } from "lucide-react";
import { zelleAccountsApi } from "../../../lib/api/zelle-accounts";
import { extractErrorMessage } from "../../../lib/extract-error-message";
import { Button, Input } from "../../../components/ui";
import type { ZelleAccount, CreateZelleAccountDto } from "@foodorder/types";

type ContactType = "email" | "phone";

interface Draft {
  contactType: ContactType;
  contact: string;
  holderName: string;
  bankApp: string;
  alias: string;
  isDefault: boolean;
}

const EMPTY: Draft = {
  contactType: "email",
  contact: "",
  holderName: "",
  bankApp: "",
  alias: "",
  isDefault: false,
};

function toDto(d: Draft): CreateZelleAccountDto {
  return {
    contactType: d.contactType,
    contact: d.contact,
    holderName: d.holderName,
    bankApp: d.bankApp || undefined,
    alias: d.alias || undefined,
    isDefault: d.isDefault,
  };
}

function fromAccount(a: ZelleAccount): Draft {
  return {
    contactType: a.contactType,
    contact: a.contact,
    holderName: a.holderName,
    bankApp: a.bankApp ?? "",
    alias: a.alias ?? "",
    isDefault: a.isDefault,
  };
}

function AccountForm({
  draft,
  onChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: Draft;
  onChange: (d: Draft) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const canSave =
    draft.contact.trim().length >= 3 && draft.holderName.trim().length >= 2;

  return (
    <div className="border border-border rounded-xl p-4 space-y-3 bg-bg">
      <div className="flex gap-2">
        {(["email", "phone"] as ContactType[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => set({ contactType: t, contact: "" })}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              draft.contactType === t
                ? "bg-primary text-white border-primary"
                : "border-border text-muted hover:border-primary hover:text-primary"
            }`}
          >
            {t === "email" ? "Email" : "Teléfono"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label={
            draft.contactType === "email" ? "Email Zelle *" : "Teléfono Zelle *"
          }
          value={draft.contact}
          onChange={(e) => set({ contact: e.target.value })}
          placeholder={
            draft.contactType === "email"
              ? "ejemplo@email.com"
              : "+1 (555) 123-4567"
          }
          type={draft.contactType === "email" ? "email" : "tel"}
        />
        <Input
          label="Nombre del titular *"
          value={draft.holderName}
          onChange={(e) => set({ holderName: e.target.value })}
          placeholder="Ej: María González"
        />
        <Input
          label="App bancaria (opcional)"
          value={draft.bankApp}
          onChange={(e) => set({ bankApp: e.target.value })}
          placeholder="Ej: Bank of America, Chase"
        />
        <Input
          label="Alias (opcional)"
          value={draft.alias}
          onChange={(e) => set({ alias: e.target.value })}
          placeholder="Ej: Zelle principal"
        />
        <div className="flex items-end gap-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm text-app-text">
            <input
              type="checkbox"
              checked={draft.isDefault}
              onChange={(e) => set({ isDefault: e.target.checked })}
              className="w-4 h-4 accent-primary rounded"
            />
            Cuenta predeterminada
          </label>
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" loading={saving} disabled={!canSave} onClick={onSave}>
          <Check size={14} className="mr-1" /> Guardar
        </Button>
      </div>
    </div>
  );
}

export function ZelleAccountsManager() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY });

  const { data: accounts = [] } = useQuery<ZelleAccount[]>({
    queryKey: ["zelle-accounts"],
    queryFn: zelleAccountsApi.list,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["zelle-accounts"] });

  const create = useMutation({
    mutationFn: (d: Draft) => zelleAccountsApi.create(toDto(d)),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setDraft({ ...EMPTY });
      toast.success("Cuenta Zelle agregada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo agregar la cuenta")),
  });

  const update = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Draft }) =>
      zelleAccountsApi.update(id, toDto(d)),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setDraft({ ...EMPTY });
      toast.success("Cuenta Zelle actualizada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo actualizar la cuenta")),
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => zelleAccountsApi.setDefault(id),
    onSuccess: () => {
      invalidate();
      toast.success("Cuenta predeterminada actualizada");
    },
    onError: (err) =>
      toast.error(
        extractErrorMessage(err, "No se pudo cambiar la cuenta predeterminada"),
      ),
  });

  const remove = useMutation({
    mutationFn: (id: string) => zelleAccountsApi.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success("Cuenta eliminada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo eliminar la cuenta")),
  });

  const startEdit = (a: ZelleAccount) => {
    setEditingId(a._id);
    setDraft(fromAccount(a));
    setAdding(false);
  };

  const cancelForm = () => {
    setAdding(false);
    setEditingId(null);
    setDraft({ ...EMPTY });
  };

  return (
    <section className="bg-surface border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-app-text">Cuentas Zelle</h2>
          <p className="text-xs text-muted mt-1">
            Datos para que los clientes te envíen pagos por Zelle
          </p>
        </div>
        {!adding && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setDraft({ ...EMPTY });
            }}
          >
            <Plus size={14} className="mr-1" /> Agregar
          </Button>
        )}
      </div>

      {accounts.length === 0 && !adding && (
        <p className="text-sm text-muted text-center py-4">
          No hay cuentas configuradas. Agregá una para poder usar Zelle en links
          de pago.
        </p>
      )}

      <div className="space-y-3">
        {accounts.map((a) => (
          <div key={a._id}>
            {editingId === a._id ? (
              <AccountForm
                draft={draft}
                onChange={setDraft}
                saving={update.isPending}
                onSave={() => update.mutate({ id: a._id, d: draft })}
                onCancel={cancelForm}
              />
            ) : (
              <div
                className={`border rounded-xl p-3.5 flex items-start gap-3 ${
                  a.isDefault
                    ? "border-primary/40 bg-primary/5"
                    : "border-border"
                } ${!a.isActive ? "opacity-50" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-app-text text-sm">
                      {a.holderName}
                    </p>
                    <span className="text-xs bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full">
                      Zelle
                    </span>
                    {a.isDefault && (
                      <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full font-medium">
                        Predeterminada
                      </span>
                    )}
                  </div>
                  {a.alias && (
                    <p className="text-xs text-primary mt-0.5">{a.alias}</p>
                  )}
                  <p className="text-sm font-mono text-app-text mt-1">
                    {a.contact}
                  </p>
                  {a.bankApp && (
                    <p className="text-xs text-muted mt-0.5">{a.bankApp}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {!a.isDefault && (
                    <button
                      title="Hacer predeterminada"
                      onClick={() => setDefault.mutate(a._id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                    >
                      <Star size={15} />
                    </button>
                  )}
                  <button
                    title="Editar"
                    onClick={() => startEdit(a)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    title="Eliminar"
                    onClick={() => remove.mutate(a._id)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-red-500 hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {adding && (
        <AccountForm
          draft={draft}
          onChange={setDraft}
          saving={create.isPending}
          onSave={() => create.mutate(draft)}
          onCancel={cancelForm}
        />
      )}
    </section>
  );
}
