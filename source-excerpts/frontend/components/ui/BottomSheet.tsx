import { useEffect } from "react";

interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

/**
 * Bottom-sheet modal para mobile. Cierra con Escape, click en backdrop, o
 * llamando onClose desde los hijos. Accesible: role="dialog" + aria-modal.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
}: BottomSheetProps) {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end"
      style={{ background: "rgba(0,0,0,0.45)" }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="bs-title"
    >
      <div
        className="bg-white w-full max-w-2xl mx-auto p-5 pb-safe-8 animate-slide-up-sheet"
        style={{ borderRadius: "20px 20px 0 0" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 id="bs-title" className="text-lg font-bold">
            {title}
          </h3>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center border-none cursor-pointer"
          >
            &#x2715;
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
