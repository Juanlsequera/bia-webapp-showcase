import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus,
  Pencil,
  Trash2,
  Star,
  StarOff,
  Check,
  X,
  QrCode,
  Download,
  Printer,
  Upload,
  Loader2,
  AlertTriangle,
  ScanLine,
} from "lucide-react";
import QRCode from "qrcode";
import { bankAccountsApi } from "../../../lib/api";
import { extractErrorMessage } from "../../../lib/extract-error-message";
import { Button, Input } from "../../../components/ui";
import type { BankAccount } from "@foodorder/types";
import { VENEZOLANO_BANKS, getBankByCode } from "../../../lib/venezolano-banks";
import {
  buildPagoMovilQrPayload,
  pagoMovilQrToDataUrl,
} from "../../../lib/pagomovil-qr";
import {
  decodeQrFromFile,
  parseS7BPayload,
  diffWithManual,
  type ParsedS7B,
} from "../../../lib/qr-decoder";

/**
 * Gestor de cuentas bancarias PagoMóvil del tenant.
 *
 * Extraído de AdminSettingsPage.tsx (2026-05-25) y movido a la pestaña Pagos
 * para unificar todo lo relacionado al cobro (cuentas + métodos habilitados +
 * auto-aprobación) en una sola pestaña.
 */

interface DraftAccount {
  bank: string;
  bankCode: string;
  phone: string;
  rif: string;
  accountHolder: string;
  /** URL del QR actualmente guardado en el server (solo en edición). */
  qrImageUrl: string | null;
  /** Payload crudo del QR. Sincronizado con qrFile cuando se sube uno nuevo. */
  qrRawPayload: string | null;
  /** Archivo pendiente de subir (no se persiste hasta hacer save). */
  qrFile: File | null;
  /** ObjectURL para preview del qrFile. */
  qrFilePreview: string | null;
  /** True si el usuario quitó el QR existente (solo aplica en edición). */
  qrRemoved: boolean;
}

const EMPTY_ACCOUNT: DraftAccount = {
  bank: "",
  bankCode: "",
  phone: "",
  rif: "",
  accountHolder: "",
  qrImageUrl: null,
  qrRawPayload: null,
  qrFile: null,
  qrFilePreview: null,
  qrRemoved: false,
};

/** Modal con QR imprimible para una cuenta bancaria.
 *  Prioridad: (1) QR S7B subido por el tenant → (2) EMVCo experimental → (3) QR texto. */
function BankAccountQRModal({
  account,
  onClose,
}: {
  account: BankAccount;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [emvcoUrl, setEmvcoUrl] = useState<string | null>(null);

  const hasUploadedQr = !!account.qrImageUrl;
  const hasEmvco = !hasUploadedQr && !!account.bankCode;

  // Generar QR EMVCo solo si no hay QR S7B subido
  useEffect(() => {
    if (!hasEmvco) return;
    pagoMovilQrToDataUrl(
      buildPagoMovilQrPayload({
        bankCode: account.bankCode!,
        phone: account.phone,
        documentId: account.rif,
        merchantName: account.accountHolder.slice(0, 25),
        city: "",
      }),
      280,
    )
      .then(setEmvcoUrl)
      .catch(() => setEmvcoUrl(null));
  }, [
    account.bankCode,
    account.phone,
    account.rif,
    account.accountHolder,
    hasEmvco,
  ]);

  // QR de texto plano — solo cuando no hay ni QR S7B ni EMVCo
  const qrText = [
    `Banco: ${account.bank}`,
    `Teléfono: ${account.phone}`,
    `RIF/Cédula: ${account.rif}`,
    `Titular: ${account.accountHolder}`,
  ].join("\n");

  useEffect(() => {
    if (hasUploadedQr) return;
    if (hasEmvco && emvcoUrl) return;
    if (!canvasRef.current) return;
    QRCode.toCanvas(canvasRef.current, qrText, {
      width: 280,
      margin: 2,
      color: { dark: "#1e1b4b", light: "#ffffff" },
    });
  }, [qrText, hasEmvco, emvcoUrl, hasUploadedQr]);

  const handleDownload = () => {
    const slug = account.bank.toLowerCase().replace(/\s+/g, "-");
    if (hasUploadedQr && account.qrImageUrl) {
      const a = document.createElement("a");
      a.download = `qr-s7b-${slug}.png`;
      a.href = account.qrImageUrl;
      a.target = "_blank";
      a.click();
      return;
    }
    if (hasEmvco && emvcoUrl) {
      const a = document.createElement("a");
      a.download = `qr-pagomovil-emvco-${slug}.png`;
      a.href = emvcoUrl;
      a.click();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement("a");
    a.download = `qr-pagomovil-${slug}.png`;
    a.href = canvas.toDataURL("image/png");
    a.click();
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 print:bg-white print:static"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-modal-title"
    >
      <div
        className="bg-surface rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-xl max-h-[90vh] overflow-y-auto print:shadow-none print:rounded-none print:p-0"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between print:hidden">
          <div>
            <h3 id="qr-modal-title" className="font-bold text-app-text">
              QR PagoMóvil
            </h3>
            <p className="text-xs text-muted mt-0.5">{account.bank}</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* QR */}
        <div className="flex flex-col items-center gap-3">
          {hasUploadedQr && account.qrImageUrl ? (
            <>
              <img
                src={account.qrImageUrl}
                alt="QR S7B"
                className="rounded-xl"
                style={{ width: 280 }}
              />
              <p className="text-xs text-emerald-700 font-medium text-center print:hidden">
                ✓ QR S7B oficial — el cliente lo escanea desde su app bancaria
              </p>
            </>
          ) : hasEmvco && emvcoUrl ? (
            <>
              <img
                src={emvcoUrl}
                alt="QR PagoMóvil EMVCo"
                className="rounded-xl"
                style={{ width: 280 }}
              />
              <p className="text-xs text-amber-600 font-medium text-center print:hidden">
                ⚠ QR EMVCo experimental — recomendamos subir el QR S7B oficial
                desde la app de tu banco
              </p>
            </>
          ) : (
            <>
              <canvas ref={canvasRef} className="rounded-xl" />
              {hasEmvco && !emvcoUrl && (
                <p className="text-xs text-muted text-center">Generando QR…</p>
              )}
            </>
          )}

          <div className="text-center space-y-0.5">
            <p className="font-bold text-app-text">{account.bank}</p>
            <p className="text-sm font-mono text-primary">{account.phone}</p>
            <p className="text-xs text-muted">
              {account.rif} · {account.accountHolder}
            </p>
          </div>

          {/* Disclaimer de compatibilidad */}
          {hasUploadedQr ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2.5 text-xs text-emerald-800 text-center print:hidden">
              <p className="font-semibold mb-0.5">Cómo lo usa el cliente</p>
              <p>
                1. Abre la app de su banco (Bancaribe, Provincial, BDV,
                Banesco…).
              </p>
              <p>2. Va a "Pago con QR" o "Mi QR".</p>
              <p>3. Escanea este código — los datos se autocompletan.</p>
              <p className="mt-1 text-emerald-700">
                No funciona con la cámara nativa del celular.
              </p>
            </div>
          ) : hasEmvco ? (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 text-xs text-amber-800 text-center print:hidden">
              <p className="font-semibold mb-0.5">Sube el QR S7B de tu banco</p>
              <p>
                Este QR EMVCo es experimental y los bancos venezolanos usan QR
                S7B (Suiche 7B).
              </p>
              <p className="mt-1 text-amber-700">
                Genera el QR estático en tu app bancaria y súbelo al editar esta
                cuenta.
              </p>
            </div>
          ) : (
            <p className="text-xs text-muted text-center px-4 print:hidden">
              El cliente ve los datos para copiar. Para que pueda escanear desde
              su app bancaria, sube el QR S7B de tu banco al editar esta cuenta.
            </p>
          )}
        </div>

        {/* Acciones */}
        <div className="flex gap-2 print:hidden">
          <Button
            variant="secondary"
            size="sm"
            className="flex-1"
            onClick={handleDownload}
          >
            <Download size={14} className="mr-1.5" /> Descargar PNG
          </Button>
          <Button size="sm" className="flex-1" onClick={() => window.print()}>
            <Printer size={14} className="mr-1.5" /> Imprimir
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Uploader del QR S7B — file picker + decoder + preview ────────────────────
// Componente standalone para evitar el problema de redefinición que ya
// documenta el comentario del DraftForm.
function BankQrUploader({
  draft,
  parsed,
  onApply,
  onRemove,
}: {
  draft: DraftAccount;
  parsed: ParsedS7B | null;
  onApply: (next: Partial<DraftAccount>) => void;
  onRemove: () => void;
}) {
  const [decoding, setDecoding] = useState(false);

  const previewSrc =
    draft.qrFilePreview ?? (draft.qrRemoved ? null : draft.qrImageUrl);
  const hasQr = !!previewSrc;

  const handlePick = async (file: File | undefined) => {
    if (!file) return;
    setDecoding(true);
    try {
      const previewUrl = URL.createObjectURL(file);
      // Revocar el preview previo si lo hubiera
      if (draft.qrFilePreview) URL.revokeObjectURL(draft.qrFilePreview);

      const decoded = await decodeQrFromFile(file);
      if (!decoded) {
        // No se pudo leer ningún QR — igual aceptamos la imagen para entrada manual
        onApply({
          qrFile: file,
          qrFilePreview: previewUrl,
          qrRawPayload: null,
          qrRemoved: false,
        });
        toast.warning(
          "Subimos la imagen pero no pudimos leer un QR adentro. Llena los datos manualmente.",
          { duration: 6000 },
        );
        return;
      }

      const parsedNew = parseS7BPayload(decoded);
      // Auto-rellenar solo si el campo está vacío. Si ya tiene dato, dejamos
      // que el mismatch warning lo resuelva.
      const patch: Partial<DraftAccount> = {
        qrFile: file,
        qrFilePreview: previewUrl,
        qrRawPayload: decoded,
        qrRemoved: false,
      };
      if (!draft.bank && parsedNew.bank) {
        patch.bank = parsedNew.bank.name;
        patch.bankCode = parsedNew.bank.code;
      } else if (!draft.bankCode && parsedNew.bankCode) {
        patch.bankCode = parsedNew.bankCode;
      }
      if (!draft.phone && parsedNew.phone) patch.phone = parsedNew.phone;
      if (!draft.rif && parsedNew.documentId) patch.rif = parsedNew.documentId;
      if (!draft.accountHolder && parsedNew.accountHolder) {
        patch.accountHolder = parsedNew.accountHolder;
      }
      onApply(patch);

      if (parsedNew.format === "unknown") {
        toast.info(
          "QR leído. No reconocimos el formato — completa los datos manualmente.",
        );
      } else if (parsedNew.format === "s7b-token") {
        toast.success(
          parsedNew.bank
            ? `QR S7B de ${parsedNew.bank.name} reconocido. Completa teléfono, RIF y titular a mano (el QR no los incluye).`
            : "QR S7B reconocido. Completa los demás datos manualmente.",
          { duration: 6000 },
        );
      } else {
        const detected = [
          parsedNew.bank && `banco ${parsedNew.bank.name}`,
          parsedNew.phone && `teléfono ${parsedNew.phone}`,
          parsedNew.documentId && `documento ${parsedNew.documentId}`,
        ]
          .filter(Boolean)
          .join(", ");
        toast.success(
          detected ? `Detectamos: ${detected}.` : "QR leído correctamente.",
        );
      }
    } catch (err) {
      console.error("decodeQrFromFile failed", err);
      toast.error("No se pudo procesar la imagen del QR.");
    } finally {
      setDecoding(false);
    }
  };

  return (
    <div className="border border-dashed border-border rounded-xl p-3 space-y-2 bg-bg/40">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-app-text flex items-center gap-1.5">
            <ScanLine size={13} className="text-primary" /> QR S7B (Suiche 7B)
          </p>
          <p className="text-xs text-muted mt-0.5">
            Sube el QR estático que generaste en tu app bancaria (Bancaribe "Mi
            QR", Provincial "Mi QR", BDV PagomóvilBDV Comercio…). Intentamos
            leerlo para autocompletar los campos.
          </p>
          {parsed && parsed.format === "s7b-token" && (
            <div className="text-xs text-emerald-700 mt-1 space-y-0.5">
              <p>
                ✓ QR S7B reconocido{parsed.bank && ` · ${parsed.bank.name}`}
              </p>
              <p className="text-muted">
                El QR S7B no incluye teléfono ni cédula — el switch los resuelve
                a partir del banco. Completa esos datos a mano para que el
                cliente los vea como respaldo si no usa el QR.
              </p>
            </div>
          )}
          {parsed &&
            parsed.format !== "s7b-token" &&
            parsed.format !== "unknown" && (
              <p className="text-xs text-emerald-700 mt-1">
                Formato detectado:{" "}
                <span className="font-semibold">
                  {parsed.format.toUpperCase()}
                </span>
                {parsed.bank && ` · banco ${parsed.bank.name}`}
              </p>
            )}
          {parsed && parsed.format === "unknown" && (
            <p className="text-xs text-amber-700 mt-1">
              No reconocimos el formato del QR — la imagen igual se va a guardar
              para mostrarla al cliente.
            </p>
          )}
        </div>
        {hasQr && previewSrc && (
          <img
            src={previewSrc}
            alt="QR S7B"
            className="w-20 h-20 rounded-lg border border-border object-cover"
          />
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <label
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition-colors
          ${decoding ? "border-primary/40 bg-primary/5 text-primary" : "border-border text-muted hover:border-primary hover:text-primary"}`}
        >
          {decoding ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <Upload size={13} />
          )}
          {decoding ? "Leyendo…" : hasQr ? "Reemplazar QR" : "Subir QR"}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            disabled={decoding}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              handlePick(f);
            }}
          />
        </label>
        {hasQr && (
          <button
            type="button"
            onClick={onRemove}
            className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted hover:text-red-500 hover:border-red-300 transition-colors"
          >
            Quitar QR
          </button>
        )}
      </div>
    </div>
  );
}

// ── DraftForm extraído como componente standalone ────────────────────────────
// IMPORTANTE: debe vivir FUERA de BankAccountsManager. Si se define adentro,
// React lo trata como un tipo nuevo en cada render y pierde el foco tras cada tecla.
function DraftForm({
  draft,
  onDraftChange,
  onSave,
  onCancel,
  saving,
}: {
  draft: DraftAccount;
  onDraftChange: (updated: DraftAccount) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
}) {
  // Si el banco guardado no está en el catálogo, mostrar "Otro" + input libre
  const isKnownBank = VENEZOLANO_BANKS.some((b) => b.name === draft.bank);
  const selectValue =
    draft.bank === "" ? "" : isKnownBank ? draft.bank : "__otro";

  const handleBankSelect = (value: string) => {
    if (value === "__otro") {
      onDraftChange({ ...draft, bank: "", bankCode: "" });
    } else {
      const found = VENEZOLANO_BANKS.find((b) => b.name === value);
      onDraftChange({ ...draft, bank: value, bankCode: found?.code ?? "" });
    }
  };

  // Parsea el QR (si hay payload). useMemo evita reparsing en cada render.
  const parsed = useMemo<ParsedS7B | null>(() => {
    if (!draft.qrRawPayload) return null;
    return parseS7BPayload(draft.qrRawPayload);
  }, [draft.qrRawPayload]);

  // Mismatches entre QR y form. Bloquean el save si hay alguno.
  const mismatches = useMemo(() => {
    if (!parsed) return [];
    return diffWithManual(parsed, {
      bankCode: draft.bankCode || null,
      phone: draft.phone,
      rif: draft.rif,
    });
  }, [parsed, draft.bankCode, draft.phone, draft.rif]);

  const applyQrValue = (
    field: "bankCode" | "phone" | "documentId",
    value: string,
  ) => {
    if (field === "bankCode") {
      const bank = VENEZOLANO_BANKS.find((b) => b.code === value);
      onDraftChange({
        ...draft,
        bankCode: value,
        bank: bank?.name ?? draft.bank,
      });
    } else if (field === "phone") {
      onDraftChange({ ...draft, phone: value });
    } else {
      onDraftChange({ ...draft, rif: value });
    }
  };

  return (
    <div className="border border-border rounded-xl p-4 space-y-3 bg-bg animate-slide-up">
      {/* Uploader del QR — arriba del form para que el flow sugerido sea QR → autofill */}
      <BankQrUploader
        draft={draft}
        parsed={parsed}
        onApply={(patch) => onDraftChange({ ...draft, ...patch })}
        onRemove={() => {
          if (draft.qrFilePreview) URL.revokeObjectURL(draft.qrFilePreview);
          onDraftChange({
            ...draft,
            qrFile: null,
            qrFilePreview: null,
            qrRawPayload: null,
            // Si había uno guardado en server, marcar para borrar al guardar.
            qrRemoved: !!draft.qrImageUrl,
          });
        }}
      />

      {/* Mismatches con el QR — bloquean el save */}
      {mismatches.length > 0 && (
        <div className="bg-red-50 border border-red-300 rounded-xl px-3 py-2 space-y-1.5">
          <p className="text-xs font-semibold text-red-700 flex items-center gap-1">
            <AlertTriangle size={13} /> Los datos no coinciden con el QR
          </p>
          {mismatches.map((m) => (
            <div
              key={m.field}
              className="text-xs text-red-800 flex items-center gap-2 flex-wrap"
            >
              <span>
                <strong>
                  {m.field === "bankCode"
                    ? "Banco"
                    : m.field === "phone"
                      ? "Teléfono"
                      : "Documento"}
                  :
                </strong>{" "}
                QR dice{" "}
                <code className="font-mono bg-red-100 px-1 rounded">
                  {m.qrValue}
                </code>
                , formulario tiene{" "}
                <code className="font-mono bg-red-100 px-1 rounded">
                  {m.formValue}
                </code>
              </span>
              <button
                type="button"
                onClick={() => applyQrValue(m.field, m.qrValue)}
                className="text-xs underline hover:no-underline"
              >
                Usar valor del QR
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Selector de banco con catálogo SUDEBAN */}
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted">Banco *</label>
          <select
            value={selectValue}
            onChange={(e) => handleBankSelect(e.target.value)}
            className="border border-border rounded-xl px-3 py-2.5 text-sm text-app-text bg-bg focus:outline-none focus:border-primary transition-colors"
          >
            <option value="" disabled>
              Selecciona un banco
            </option>
            {VENEZOLANO_BANKS.map((b) => (
              <option key={b.code} value={b.name}>
                {b.name}
              </option>
            ))}
            <option value="__otro">Otro banco…</option>
          </select>
          {/* Input libre cuando el banco no está en el catálogo */}
          {selectValue === "__otro" && (
            <Input
              value={draft.bank}
              placeholder="Nombre del banco"
              onChange={(e) =>
                onDraftChange({ ...draft, bank: e.target.value, bankCode: "" })
              }
            />
          )}
          {draft.bankCode && (
            <p className="text-xs text-muted">
              Código SUDEBAN: {draft.bankCode}
              {getBankByCode(draft.bankCode) ? "" : " (no reconocido)"}
            </p>
          )}
        </div>

        <Input
          label="Teléfono *"
          value={draft.phone}
          placeholder="ej: 04141234567"
          onChange={(e) => onDraftChange({ ...draft, phone: e.target.value })}
        />
        <Input
          label="RIF o Cédula *"
          value={draft.rif}
          placeholder="ej: J-12345678-9"
          onChange={(e) => onDraftChange({ ...draft, rif: e.target.value })}
        />
        <Input
          label="Titular *"
          value={draft.accountHolder}
          placeholder="ej: Burger Demo C.A."
          onChange={(e) =>
            onDraftChange({ ...draft, accountHolder: e.target.value })
          }
        />
      </div>
      <div className="flex gap-2 justify-end">
        <Button variant="secondary" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button
          size="sm"
          loading={saving}
          disabled={
            !draft.bank ||
            !draft.phone ||
            !draft.rif ||
            !draft.accountHolder ||
            mismatches.length > 0
          }
          onClick={onSave}
        >
          <Check size={14} className="mr-1" /> Guardar
        </Button>
      </div>
    </div>
  );
}

export function BankAccountsManager() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState(EMPTY_ACCOUNT);
  const [qrAccount, setQrAccount] = useState<BankAccount | null>(null);

  const { data: accounts = [] } = useQuery<BankAccount[]>({
    queryKey: ["bank-accounts"],
    queryFn: bankAccountsApi.list,
  });

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["bank-accounts"] });

  // Helper: extrae los campos primarios del draft (lo que va al POST/PATCH del
  // account). Las operaciones de QR (upload/delete) son llamadas aparte.
  const toAccountDto = (d: DraftAccount) => ({
    bank: d.bank,
    bankCode: d.bankCode || undefined,
    phone: d.phone,
    rif: d.rif,
    accountHolder: d.accountHolder,
    qrRawPayload: d.qrRawPayload || undefined,
  });

  // Aplica las operaciones de QR sobre una cuenta dada: subir si hay qrFile,
  // borrar si qrRemoved. No bloquea el flujo principal si Cloudinary falla
  // (la cuenta queda guardada igual y el admin puede reintentar la subida).
  const applyQrSideEffects = async (accountId: string, d: DraftAccount) => {
    if (d.qrFile) {
      await bankAccountsApi.uploadQr(
        accountId,
        d.qrFile,
        d.qrRawPayload ?? undefined,
      );
    } else if (d.qrRemoved) {
      await bankAccountsApi.deleteQr(accountId);
    }
  };

  const create = useMutation({
    mutationFn: async (d: DraftAccount) => {
      const accounts = await bankAccountsApi.create(toAccountDto(d));
      // Asumimos que la nueva cuenta es la última. Si subimos QR, llamar al endpoint.
      const created = accounts[accounts.length - 1];
      if (created && (d.qrFile || d.qrRemoved)) {
        try {
          await applyQrSideEffects(created._id, d);
        } catch (err) {
          // No abortamos — la cuenta ya está creada. Informamos pero seguimos.
          console.error("QR upload failed after create", err);
          toast.warning(
            "La cuenta se creó, pero no pudimos subir el QR. Vuelve a intentarlo desde editar.",
          );
        }
      }
    },
    onSuccess: () => {
      if (draft.qrFilePreview) URL.revokeObjectURL(draft.qrFilePreview);
      invalidate();
      setAdding(false);
      setDraft(EMPTY_ACCOUNT);
      toast.success("Cuenta agregada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo agregar la cuenta")),
  });

  const update = useMutation({
    mutationFn: async ({ id, d }: { id: string; d: DraftAccount }) => {
      await bankAccountsApi.update(id, toAccountDto(d));
      if (d.qrFile || d.qrRemoved) {
        await applyQrSideEffects(id, d);
      }
    },
    onSuccess: () => {
      if (draft.qrFilePreview) URL.revokeObjectURL(draft.qrFilePreview);
      invalidate();
      setEditingId(null);
      setDraft(EMPTY_ACCOUNT);
      toast.success("Cuenta actualizada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo actualizar la cuenta")),
  });

  const setDefault = useMutation({
    mutationFn: (id: string) => bankAccountsApi.setDefault(id),
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
    mutationFn: (id: string) => bankAccountsApi.remove(id),
    onSuccess: () => {
      invalidate();
      toast.success("Cuenta eliminada");
    },
    onError: (err) =>
      toast.error(extractErrorMessage(err, "No se pudo eliminar la cuenta")),
  });

  const startEdit = (a: BankAccount) => {
    setEditingId(a._id);
    setDraft({
      bank: a.bank,
      bankCode: a.bankCode ?? "",
      phone: a.phone,
      rif: a.rif,
      accountHolder: a.accountHolder,
      qrImageUrl: a.qrImageUrl ?? null,
      qrRawPayload: a.qrRawPayload ?? null,
      qrFile: null,
      qrFilePreview: null,
      qrRemoved: false,
    });
    setAdding(false);
  };

  const cancelForm = () => {
    if (draft.qrFilePreview) URL.revokeObjectURL(draft.qrFilePreview);
    setAdding(false);
    setEditingId(null);
    setDraft(EMPTY_ACCOUNT);
  };

  return (
    <section className="bg-surface border border-border rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-app-text">Cuentas PagoMóvil</h2>
          <p className="text-xs text-muted mt-1">
            Los clientes ven estos datos al momento de pagar
          </p>
        </div>
        {!adding && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAdding(true);
              setEditingId(null);
            }}
          >
            <Plus size={14} className="mr-1" /> Agregar
          </Button>
        )}
      </div>

      {/* Lista de cuentas existentes */}
      {accounts.length === 0 && !adding && (
        <p className="text-sm text-muted text-center py-4">
          No hay cuentas configuradas. Agregá la primera para que los clientes
          puedan pagar con PagoMóvil.
        </p>
      )}

      <div className="space-y-3">
        {accounts.map((a) => (
          <div key={a._id} className="animate-fade-in">
            {editingId === a._id ? (
              <DraftForm
                draft={draft}
                onDraftChange={setDraft}
                saving={update.isPending}
                onSave={() => update.mutate({ id: a._id, d: draft })}
                onCancel={cancelForm}
              />
            ) : (
              <div
                className={`border rounded-xl p-3.5 flex items-start gap-3 transition-colors ${
                  a.isDefault
                    ? "border-primary/40 bg-primary/5"
                    : "border-border"
                } ${!a.isActive ? "opacity-50" : ""}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-app-text text-sm">
                      {a.bank}
                    </p>
                    {a.isDefault && (
                      <span className="text-xs bg-primary/15 text-primary px-2 py-0.5 rounded-full font-medium">
                        Predeterminada
                      </span>
                    )}
                    {!a.isActive && (
                      <span className="text-xs bg-border text-muted px-2 py-0.5 rounded-full">
                        Inactiva
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-app-text mt-1 font-mono">
                    {a.phone}
                  </p>
                  <p className="text-xs text-muted mt-0.5">
                    {a.rif} · {a.accountHolder}
                  </p>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    data-tour="settings-bank-qr"
                    title="Ver QR imprimible"
                    onClick={() => setQrAccount(a)}
                    className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                  >
                    <QrCode size={15} />
                  </button>
                  {!a.isDefault && (
                    <button
                      title="Hacer predeterminada"
                      onClick={() => setDefault.mutate(a._id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors"
                    >
                      <Star size={15} />
                    </button>
                  )}
                  {a.isDefault && accounts.length > 1 && (
                    <button
                      disabled
                      title="Predeterminada"
                      className="w-8 h-8 flex items-center justify-center rounded-lg text-primary opacity-60"
                    >
                      <StarOff size={15} />
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

      {/* Formulario de nueva cuenta */}
      {adding && (
        <DraftForm
          draft={draft}
          onDraftChange={setDraft}
          saving={create.isPending}
          onSave={() => create.mutate(draft)}
          onCancel={cancelForm}
        />
      )}

      {/* Modal QR */}
      {qrAccount && (
        <BankAccountQRModal
          account={qrAccount}
          onClose={() => setQrAccount(null)}
        />
      )}
    </section>
  );
}
