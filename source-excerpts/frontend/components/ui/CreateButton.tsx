import { Plus, type LucideIcon } from "lucide-react";

interface CreateButtonProps {
  /** Texto visible en desktop y aria-label en mobile (FAB). */
  label: string;
  /** Ícono del botón. Por defecto: Plus. */
  icon?: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  /** Clases extra para el botón desktop (por si necesitás sobreescribir). */
  className?: string;
  /** data-tour attribute para el tour de ayuda. */
  dataTour?: string;
}

/**
 * Botón de acción primario (crear / nuevo) con comportamiento responsive:
 * - **Desktop (md+)**: botón normal con ícono + texto.
 * - **Mobile (< md)**: FAB circular fijo en la esquina inferior derecha.
 *
 * Uso:
 * ```tsx
 * <CreateButton label="Nuevo profesional" onClick={() => setOpen(true)} />
 * ```
 */
export function CreateButton({
  label,
  icon: Icon = Plus,
  onClick,
  disabled = false,
  className = "",
  dataTour,
}: CreateButtonProps) {
  return (
    <>
      {/* Desktop: botón normal con texto */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        data-tour={dataTour}
        className={`hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white text-sm font-semibold bg-primary hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-opacity flex-shrink-0 whitespace-nowrap ${className}`}
      >
        <Icon size={16} className="flex-shrink-0" />
        {label}
      </button>

      {/* Mobile: FAB circular fijo */}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        data-tour={dataTour}
        className="md:hidden fixed bottom-5 right-5 z-20 w-14 h-14 rounded-full shadow-lg flex items-center justify-center bg-primary text-white hover:opacity-90 active:opacity-80 disabled:opacity-50 transition-opacity"
      >
        <Icon size={24} />
      </button>
    </>
  );
}
