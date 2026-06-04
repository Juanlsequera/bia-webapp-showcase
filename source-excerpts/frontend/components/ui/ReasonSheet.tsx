import { useState, useEffect } from "react";
import { BottomSheet } from "./BottomSheet";

interface ReasonSheetProps {
  open: boolean;
  onClose: () => void;
  /** Título del sheet (ej: "Motivo del rechazo") */
  title: string;
  /** Descripción bajo el título */
  description: string;
  /** Placeholder del textarea */
  placeholder: string;
  /** Texto del botón de confirmación (ej: "Confirmar rechazo") */
  confirmLabel: string;
  /** Si true, el botón de confirmar requiere que haya texto en el textarea */
  required?: boolean;
  loading?: boolean;
  /** Recibe el motivo escrito (vacío si no aplica) */
  onConfirm: (reason: string) => void;
}

/**
 * Variante de BottomSheet con textarea de motivo y dos botones (Cancelar / Confirmar).
 * Usado para rechazar pagomovil, cancelar pedido en caja, y cualquier acción
 * destructiva que admita un motivo opcional u obligatorio.
 */
export function ReasonSheet({
  open,
  onClose,
  title,
  description,
  placeholder,
  confirmLabel,
  required = false,
  loading = false,
  onConfirm,
}: ReasonSheetProps) {
  const [reason, setReason] = useState("");

  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  const canConfirm = !required || reason.trim().length > 0;

  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <p className="text-sm text-gray-500 mb-3">{description}</p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-200 rounded-xl p-3 text-sm resize-none h-24 focus:outline-none focus:border-blue-400"
      />
      <div className="flex gap-3 mt-4">
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl border border-gray-200 font-semibold text-gray-600 bg-transparent cursor-pointer"
        >
          Cancelar
        </button>
        <button
          onClick={() => {
            onConfirm(reason.trim());
            onClose();
          }}
          disabled={!canConfirm || loading}
          className="py-3 rounded-xl text-white font-bold disabled:opacity-50 cursor-pointer"
          style={{ flex: 2, background: "#E24B4A", border: "none" }}
        >
          {confirmLabel}
        </button>
      </div>
    </BottomSheet>
  );
}
