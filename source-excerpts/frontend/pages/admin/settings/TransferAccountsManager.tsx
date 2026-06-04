import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Star, Check } from "lucide-react";
import { transferAccountsApi } from "../../../lib/api/transfer-accounts";
import { extractErrorMessage } from "../../../lib/extract-error-message";
import { Button, Input } from "../../../components/ui";
import type {
  TransferAccount,
  CreateTransferAccountDto,
} from "@foodorder/types";

type Subtype = "national" | "international";
type Currency = "VES" | "USD";

interface DraftNational {
  subtype: "national";
  currency: Currency;
  accountHolder: string;
  alias: string;
  isDefault: boolean;
  bank: string;
  accountNumber: string;
  accountType: "corriente" | "ahorro" | "";
  idNumber: string;
}

interface DraftInternational {
  subtype: "international";
  currency: Currency;
  accountHolder: string;
  alias: string;
  isDefault: boolean;
  bankName: string;
  swift: string;
  iban: string;
  routingNumber: string;
  bankAddress: string;
}

type Draft = DraftNational | DraftInternational;

const EMPTY_NATIONAL: DraftNational = {
  subtype: "national",
  currency: "VES",
  accountHolder: "",
  alias: "",
  isDefault: false,
  bank: "",
  accountNumber: "",
  accountType: "",
  idNumber: "",
};
const EMPTY_INTERNATIONAL: DraftInternational = {
  subtype: "international",
  currency: "USD",
  accountHolder: "",
  alias: "",
  isDefault: false,
  bankName: "",
  swift: "",
  iban: "",
  routingNumber: "",
  bankAddress: "",
};

function toDto(d: Draft): CreateTransferAccountDto {
  if (d.subtype === "national") {
    return {
      subtype: "national",
      currency: d.currency,
      accountHolder: d.accountHolder,
      alias: d.alias || undefined,
      isDefault: d.isDefault,
      bank: d.bank || undefined,
      accountNumber: d.accountNumber || undefined,
      accountType: (d.accountType as "corriente" | "ahorro") || undefined,
      idNumber: d.idNumber || undefined,
    };
  }
  return {
    subtype: "international",
    currency: d.currency,
    accountHolder: d.accountHolder,
    alias: d.alias || undefined,
    isDefault: d.isDefault,
    bankName: d.bankName || undefined,
    swift: d.swift || undefined,
    iban: d.iban || undefined,
    routingNumber: d.routingNumber || undefined,
    bankAddress: d.bankAddress || undefined,
  };
}

function fromAccount(a: TransferAccount): Draft {
  if (a.subtype === "national") {
    return {
      subtype: "national",
      currency: a.currency as Currency,
      accountHolder: a.accountHolder,
      alias: a.alias ?? "",
      isDefault: a.isDefault,
      bank: a.bank ?? "",
      accountNumber: a.accountNumber ?? "",
      accountType: (a.accountType as "corriente" | "ahorro" | "") ?? "",
      idNumber: a.idNumber ?? "",
    };
  }
  return {
    subtype: "international",
    currency: a.currency as Currency,
    accountHolder: a.accountHolder,
    alias: a.alias ?? "",
    isDefault: a.isDefault,
    bankName: a.bankName ?? "",
    swift: a.swift ?? "",
    iban: a.iban ?? "",
    routingNumber: a.routingNumber ?? "",
    bankAddress: a.bankAddress ?? "",
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
  const set = (patch: Partial<Draft>) =>
    onChange({ ...draft, ...patch } as Draft);
  const isNational = draft.subtype === "national";
  const dn = draft as DraftNational;
  const di = draft as DraftInternational;

  const canSave =
    draft.accountHolder.trim().length >= 2 &&
    (isNational
      ? dn.bank.trim() || dn.accountNumber.trim()
      : di.iban.trim() || di.swift.trim());

  return (
    <div className="border border-border rounded-xl p-4 space-y-3 bg-bg">
      {/* Subtype selector */}
      <div className="flex gap-2">
        {(["national", "international"] as Subtype[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() =>
              onChange(
                t === "national"
                  ? { ...EMPTY_NATIONAL }
                  : { ...EMPTY_INTERNATIONAL },
              )
            }
            className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-colors ${
              draft.subtype === t
                ? "bg-primary text-white border-primary"
                : "border-border text-muted hover:border-primary hover:text-primary"
            }`}
          >
            {t === "national" ? "Nacional" : "Internacional"}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Input
          label="Titular *"
          value={draft.accountHolder}
          onChange={(e) => set({ accountHolder: e.target.value })}
          placeholder="Ej: Juan García"
        />

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Moneda</label>
          <select
            value={draft.currency}
            onChange={(e) => set({ currency: e.target.value as Currency })}
            className="border border-border rounded-xl px-3 py-2.5 text-sm text-app-text bg-bg focus:outline-none focus:border-primary"
          >
            <option value="VES">Bolívares (VES)</option>
            <option value="USD">Dólares (USD)</option>
          </select>
        </div>

        <Input
          label="Alias (opcional)"
          value={draft.alias}
          onChange={(e) => set({ alias: e.target.value })}
          placeholder="Ej: Cuenta nómina"
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

        {isNational ? (
          <>
            <Input
              label="Banco *"
              value={dn.bank}
              onChange={(e) => set({ bank: e.target.value })}
              placeholder="Ej: Banesco, Mercantil"
            />
            <Input
              label="Número de cuenta"
              value={dn.accountNumber}
              onChange={(e) => set({ accountNumber: e.target.value })}
              placeholder="0134 0000 00 0000000000"
            />
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted">
                Tipo de cuenta
              </label>
              <select
                value={dn.accountType}
                onChange={(e) =>
                  set({
                    accountType: e.target.value as "corriente" | "ahorro" | "",
                  })
                }
                className="border border-border rounded-xl px-3 py-2.5 text-sm text-app-text bg-bg focus:outline-none focus:border-primary"
              >
                <option value="">Sin especificar</option>
                <option value="corriente">Corriente</option>
                <option value="ahorro">Ahorro</option>
              </select>
            </div>
            <Input
              label="Cédula / RIF"
              value={dn.idNumber}
              onChange={(e) => set({ idNumber: e.target.value })}
              placeholder="V-12345678"
            />
          </>
        ) : (
          <>
            <Input
              label="Nombre del banco *"
              value={di.bankName}
              onChange={(e) => set({ bankName: e.target.value })}
              placeholder="Ej: Bank of America"
            />
            <Input
              label="SWIFT / BIC"
              value={di.swift}
              onChange={(e) => set({ swift: e.target.value })}
              placeholder="Ej: BOFAUS3N"
            />
            <Input
              label="IBAN / Account #"
              value={di.iban}
              onChange={(e) => set({ iban: e.target.value })}
              placeholder="Ej: US12 3456 7890"
            />
            <Input
              label="Routing number (ACH)"
              value={di.routingNumber}
              onChange={(e) => set({ routingNumber: e.target.value })}
              placeholder="Ej: 026009593"
            />
            <div className="sm:col-span-2">
              <Input
                label="Dirección del banco (opcional)"
                value={di.bankAddress}
                onChange={(e) => set({ bankAddress: e.target.value })}
                placeholder="Ej: 100 N Tryon St, Charlotte, NC"
              />
            </div>
          </>
        )}
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

export function TransferAccountsManager() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ ...EMPTY_NATIONAL });

  const { data: accounts = [] } = useQuery<TransferAccount[]>({
    queryKey: ["transfer-accounts"],
    queryFn: transferAccountsApi.list,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["transfer-accounts"] });

  const create = useMutation({
    mutationFn: (d: Draft) => transferAccountsApi.create(toDto(d)),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setDraft({ ...EMPTY_NATIONAL });
      toast.success("Cuenta agregada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo agregar la cuenta")),
  });

  const update = useMutation({
    mutationFn: ({ id, d }: { id: string; d: Draft }) =>
      transferAccountsApi.update(id, toDto(d)),
    onSuccess: () => {
      invalidate();
      setEditingId(null);
      setDraft({ ...EMPTY_NATIONAL });
      toast.success("Cuenta actualizada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo actualizar la cuenta")),
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => transferAccountsApi.setDefault(id),
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
    mutationFn: (id: string) => transferAccountsApi.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success("Cuenta eliminada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo eliminar la cuenta")),
  });

  const startEdit = (a: TransferAccount) => {
    setEditingId(a._id);
    setDraft(fromAccount(a));
    setAdding(false);
  };

  const cancelForm = () => {
    setAdding(false);
    setEditingId(null);
    setDraft({ ...EMPTY_NATIONAL });
  };

  const subtitle = (a: TransferAccount) => {
    if (a.subtype === "national") {
      return [a.bank, a.accountNumber, a.accountType]
        .filter(Boolean)
        .join(" · ");
    }
    return [a.bankName, a.swift, a.iban].filter(Boolean).join(" · ");
  };

  return (
    <section className="bg-surface border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-app-text">Cuentas Transferencia</h2>
          <p className="text-xs text-muted mt-1">
            Datos para que los clientes te envíen transferencias bancarias
          </p>
        </div>
        {!adding && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
              setDraft({ ...EMPTY_NATIONAL });
            }}
          >
            <Plus size={14} className="mr-1" /> Agregar
          </Button>
        )}
      </div>

      {accounts.length === 0 && !adding && (
        <p className="text-sm text-muted text-center py-4">
          No hay cuentas configuradas. Agregá una para poder usar transferencia
          en links de pago.
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
                      {a.accountHolder}
                    </p>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {a.subtype === "national" ? "Nacional" : "Internacional"}
                    </span>
                    <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                      {a.currency}
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
                  <p className="text-xs text-muted mt-0.5">{subtitle(a)}</p>
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
