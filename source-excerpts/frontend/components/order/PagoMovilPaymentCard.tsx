import { useState } from "react";
import {
  Copy,
  Check as CheckIcon,
  ExternalLink,
  Info,
  ScanLine,
} from "lucide-react";
import { toast } from "sonner";
import type { BankAccount } from "@foodorder/types";
import { BANK_DEEP_LINKS, openBankApp } from "../../lib/bank-deep-links";
import { formatBs } from "../../lib/money";
import { Card } from "../ui";

interface Props {
  /** Cuenta bancaria seleccionada del tenant. */
  account: BankAccount;
  /** Monto exacto que tiene que transferir el cliente, en Bs. Si null no se muestra la fila. */
  expectedBs: number | null;
}

/** Hook: copia texto al portapapeles y muestra checkmark por 2s. */
function useCopy() {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copy = (text: string, key: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 2000);
    });
  };
  return { copiedKey, copy };
}

/** Grid de botones para abrir apps bancarias venezolanas vía deep link. */
function BankAppButtons() {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted uppercase tracking-wide">
        Abre tu app de banco
      </p>
      <div className="grid grid-cols-2 gap-2">
        {BANK_DEEP_LINKS.map((bank) => (
          <button
            key={bank.id}
            type="button"
            onClick={() => openBankApp(bank)}
            className="rounded-xl py-2.5 px-3 text-white text-sm font-semibold flex items-center justify-between gap-1 active:scale-95 transition-transform"
            style={{ backgroundColor: bank.brandColor }}
          >
            <span>{bank.name}</span>
            <ExternalLink size={12} className="opacity-70 flex-shrink-0" />
          </button>
        ))}
      </div>
      <p className="text-xs text-muted text-center">
        Tu banco no aparece? Abrelo manualmente.
      </p>
    </div>
  );
}

/**
 * Card "cómo pagar" — muestra los datos PagoMóvil del tenant con copy-buttons,
 * monto exacto a transferir, y QR S7B (cuando la cuenta lo tiene configurado).
 *
 * Reutilizado por:
 *   - `PagomovilPage` (flujo de carrito)
 *   - `PaymentLinkPage` (link de pago compartido)
 */
export function PagoMovilPaymentCard({ account, expectedBs }: Props) {
  const { copiedKey, copy } = useCopy();
  const hasQr = !!account.qrImageUrl;
  const [payTab, setPayTab] = useState<"datos" | "qr">("datos");

  const copyAll = () => {
    const lines = [
      `Banco: ${account.bank}`,
      `Telefono: ${account.phone}`,
      `RIF/Cedula: ${account.rif}`,
      `Titular: ${account.accountHolder}`,
      ...(expectedBs !== null ? [`Monto: ${formatBs(expectedBs)}`] : []),
    ].join("\n");
    navigator.clipboard
      .writeText(lines)
      .then(() => toast.success("Datos copiados al portapapeles"))
      .catch(() => toast.error("No se pudo copiar"));
  };

  return (
    <Card className="space-y-4">
      {hasQr && (
        <div className="flex rounded-xl overflow-hidden border border-border">
          <button
            type="button"
            onClick={() => setPayTab("datos")}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold transition-colors"
            style={
              payTab === "datos"
                ? { background: "var(--color-primary)", color: "white" }
                : { background: "var(--color-bg)", color: "var(--color-muted)" }
            }
          >
            <Copy size={14} />
            Copiar datos
          </button>
          <button
            type="button"
            onClick={() => setPayTab("qr")}
            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-semibold transition-colors border-l border-border"
            style={
              payTab === "qr"
                ? { background: "var(--color-primary)", color: "white" }
                : { background: "var(--color-bg)", color: "var(--color-muted)" }
            }
          >
            <ScanLine size={14} />
            Leer QR
          </button>
        </div>
      )}

      {hasQr && payTab === "qr" ? (
        <div className="space-y-3">
          <BankAppButtons />
          <div className="border-t border-border pt-3 space-y-3">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              QR del negocio
            </p>
            <div className="rounded-2xl overflow-hidden border border-border/60 bg-white">
              <img
                src={account.qrImageUrl!}
                alt="QR PagoMovil del negocio"
                className="w-full h-auto block"
              />
            </div>
            <div className="flex gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800">
              <Info size={16} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p>
                Desde otro dispositivo puedes escanear este QR con tu app
                bancaria. Si estás pagando desde este celular, usa{" "}
                <button
                  type="button"
                  onClick={() => setPayTab("datos")}
                  className="font-semibold underline"
                >
                  Copiar datos
                </button>{" "}
                en su lugar.
              </p>
            </div>
            {expectedBs !== null && (
              <AmountRow
                value={expectedBs}
                copyKey="amount"
                copiedKey={copiedKey}
                copy={copy}
              />
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <BankAppButtons />
          <div className="border-t border-border pt-3 space-y-2">
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Datos para transferir
            </p>

            <CopyRow
              label="Telefono PagoMovil"
              value={account.phone}
              copyKey="phone"
              big
              copiedKey={copiedKey}
              copy={copy}
            />

            {expectedBs !== null && (
              <AmountRow
                value={expectedBs}
                copyKey="amount"
                copiedKey={copiedKey}
                copy={copy}
              />
            )}

            <CopyRow
              label="Banco"
              value={account.bank}
              copyKey="bank"
              copiedKey={copiedKey}
              copy={copy}
            />
            <CopyRow
              label="RIF/Cedula"
              value={account.rif}
              copyKey="rif"
              copiedKey={copiedKey}
              copy={copy}
            />
            <CopyRow
              label="Titular"
              value={account.accountHolder}
              copyKey="titular"
              copiedKey={copiedKey}
              copy={copy}
            />

            <button
              type="button"
              onClick={copyAll}
              className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-border text-sm font-medium text-muted hover:border-primary hover:text-primary active:scale-95 transition-all"
            >
              <Copy size={14} />
              Copiar todos los datos
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Subcomponentes locales ──────────────────────────────────────────────────

interface RowProps {
  label: string;
  value: string;
  copyKey: string;
  big?: boolean;
  copiedKey: string | null;
  copy: (text: string, key: string) => void;
}

function CopyRow({ label, value, copyKey, big, copiedKey, copy }: RowProps) {
  return (
    <div className="bg-bg border border-border rounded-xl p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted mb-0.5">{label}</p>
        <p
          className={`text-app-text truncate ${big ? "font-bold text-lg font-mono tracking-wide" : "text-sm font-medium"}`}
        >
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={() => copy(value, copyKey)}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted hover:border-primary hover:text-primary active:scale-95 transition-all"
      >
        {copiedKey === copyKey ? (
          <CheckIcon size={14} className="text-secondary" />
        ) : (
          <Copy size={14} />
        )}
        {copiedKey === copyKey ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

function AmountRow({
  value,
  copyKey,
  copiedKey,
  copy,
}: {
  value: number;
  copyKey: string;
  copiedKey: string | null;
  copy: (t: string, k: string) => void;
}) {
  return (
    <div className="bg-bg border border-border rounded-xl p-3 flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted mb-0.5">Monto exacto</p>
        <p className="font-bold text-app-text text-lg font-mono">
          {formatBs(value)}
        </p>
      </div>
      <button
        type="button"
        onClick={() => copy(String(value), copyKey)}
        className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg border border-border text-sm font-medium text-muted hover:border-primary hover:text-primary active:scale-95 transition-all"
      >
        {copiedKey === copyKey ? (
          <CheckIcon size={14} className="text-secondary" />
        ) : (
          <Copy size={14} />
        )}
        {copiedKey === copyKey ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}
