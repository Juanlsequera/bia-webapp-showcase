import { createPortal } from "react-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

interface BankPickerProps {
  options: readonly string[];
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  title?: string;
  id?: string;
  error?: boolean;
}

/**
 * Picker de banco optimizado por breakpoint.
 *
 * - Mobile  (<768px) : bottom sheet a ancho completo, height fijo 65vh,
 *                      layout CSS Grid → la fila de la lista tiene 1fr explícito
 *                      y overflow-y:auto funciona de forma garantizada.
 * - Desktop (≥768px) : popover anclado al trigger; se abre hacia arriba si no
 *                      hay espacio abajo.
 *
 * El panel se renderiza en un Portal (document.body) para evitar que
 * cualquier ancestor con transform/will-change rompa position:fixed.
 */
export function BankPicker({
  options,
  value,
  onChange,
  placeholder = "Seleccionar banco...",
  title = "Selecciona tu banco",
  id,
  error,
}: BankPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  // Layout calculado en el momento del click (síncrono, sin flash)
  const [isDesktop, setIsDesktop] = useState(false);
  const [desktopPos, setDesktopPos] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
  }>({ left: 0, width: 0 });

  const filtered = useMemo(() => {
    const q = normalize(query);
    if (!q) return options;
    return options.filter((opt) => normalize(opt).includes(q));
  }, [options, query]);

  // Abre el picker: calcula layout/posición de forma síncrona para evitar flash
  function handleOpen() {
    const desktop = window.matchMedia("(min-width: 768px)").matches;
    setIsDesktop(desktop);

    if (desktop && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const PANEL_H = 320;
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUp = spaceBelow < PANEL_H && spaceAbove > spaceBelow;

      setDesktopPos({
        left: rect.left,
        width: rect.width,
        ...(openUp
          ? { bottom: window.innerHeight - rect.top + 8 }
          : { top: rect.bottom + 8 }),
      });
    }

    setOpen(true);
  }

  // Scroll lock + Escape + autofocus
  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    if (isDesktop) {
      const t = setTimeout(() => searchRef.current?.focus(), 50);
      return () => {
        clearTimeout(t);
        document.removeEventListener("keydown", onKey);
        document.body.style.overflow = prevOverflow;
      };
    }

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, isDesktop]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function handleSelect(opt: string) {
    onChange(opt);
    close();
  }

  function handleClear() {
    onChange("");
    close();
  }

  // ── Estilos del panel ────────────────────────────────────────────────────────
  // CSS Grid con gridTemplateRows explícito: la fila de la lista recibe `1fr`
  // definido por el algoritmo de grid (no depende de flex ni de min-height).
  const panelStyle: React.CSSProperties = isDesktop
    ? {
        position: "fixed",
        left: desktopPos.left,
        width: desktopPos.width,
        ...(desktopPos.top !== undefined ? { top: desktopPos.top } : {}),
        ...(desktopPos.bottom !== undefined
          ? { bottom: desktopPos.bottom }
          : {}),
        height: "320px",
        zIndex: 9999,
        display: "grid",
        gridTemplateRows: "auto auto 1fr",
        borderRadius: "12px",
        overflow: "hidden",
        boxShadow: "0 8px 24px rgba(0,0,0,0.14)",
      }
    : {
        // Mobile: bottom sheet ancho completo, altura fija para que 1fr funcione
        position: "fixed",
        left: 0,
        right: 0,
        bottom: 0,
        height: "65vh",
        zIndex: 9999,
        display: "grid",
        gridTemplateRows: "auto auto 1fr auto",
        borderRadius: "16px 16px 0 0",
        overflow: "hidden",
        boxShadow: "0 -4px 32px rgba(0,0,0,0.18)",
      };

  const overlay = (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={close}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 9998,
          background: isDesktop ? "transparent" : "rgba(0,0,0,0.4)",
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={["bg-surface", isDesktop ? "border border-border" : ""].join(
          " ",
        )}
        style={panelStyle}
      >
        {/* Fila 1 — Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <h3 className="text-base font-semibold text-app-text flex-1 md:text-sm">
            {title}
          </h3>
          <button
            type="button"
            onClick={close}
            className="p-1.5 rounded-lg hover:bg-bg active:scale-95 transition-transform"
            aria-label="Cerrar"
          >
            <X size={18} className="text-muted" />
          </button>
        </div>

        {/* Fila 2 — Buscador */}
        <div className="px-4 py-3 md:px-3 md:py-2 border-b border-border">
          <div className="relative">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
            />
            <input
              ref={searchRef}
              type="text"
              inputMode="search"
              placeholder="Buscar banco..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-base rounded-lg border border-border bg-bg
                         focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
          </div>
        </div>

        {/* Fila 3 — Lista (1fr → altura definida por grid, overflow-y funciona) */}
        <ul
          role="listbox"
          style={{ overflowY: "auto", overscrollBehavior: "contain" }}
          className="py-1"
        >
          {value && (
            <li>
              <button
                type="button"
                onClick={handleClear}
                className="w-full text-left px-4 py-2.5 text-sm text-muted hover:bg-bg active:bg-bg"
              >
                Limpiar selección
              </button>
            </li>
          )}
          {filtered.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-muted">
              Sin resultados para &ldquo;{query}&rdquo;
            </li>
          ) : (
            filtered.map((opt) => {
              const selected = opt === value;
              return (
                <li key={opt}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selected}
                    onClick={() => handleSelect(opt)}
                    className={[
                      "w-full flex items-center justify-between gap-2",
                      "px-4 py-3 text-left text-base text-app-text",
                      "hover:bg-bg active:bg-bg transition-colors",
                      "min-h-[48px]",
                      selected ? "font-semibold text-primary" : "",
                    ].join(" ")}
                  >
                    <span className="truncate">{opt}</span>
                    {selected && (
                      <Check size={18} className="text-primary flex-shrink-0" />
                    )}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        {/* Fila 4 — Safe area iOS (solo mobile) */}
        {!isDesktop && (
          <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
        )}
      </div>
    </>
  );

  return (
    <div className="relative">
      {/* Trigger */}
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={handleOpen}
        className={[
          "w-full flex items-center justify-between gap-2",
          "rounded-xl border px-3 py-2.5 text-base bg-surface",
          "transition-colors duration-150",
          "focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary",
          error
            ? "border-red-500 focus:ring-red-400/30 focus:border-red-500"
            : "border-border",
        ].join(" ")}
      >
        <span
          className={value ? "text-app-text truncate" : "text-muted truncate"}
        >
          {value || placeholder}
        </span>
        <ChevronDown size={16} className="text-muted flex-shrink-0" />
      </button>

      {open && createPortal(overlay, document.body)}
    </div>
  );
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
}
