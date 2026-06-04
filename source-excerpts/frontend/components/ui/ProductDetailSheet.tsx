import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PublicProduct } from "@foodorder/types";
import { useCartStore } from "../../stores/cart.store";
import { toast } from "sonner";
import clsx from "clsx";

export interface ProductDetailSheetProps {
  product: PublicProduct;
  tenantSlug: string;
  onClose: () => void;
  onAddedToCart?: () => void;
}

/**
 * ProductDetailSheet — bottom sheet deslizable con el detalle del producto.
 * Reemplaza la navegación a /:slug/producto/:id dentro del catálogo.
 * Adapta su contenido según product.type (mismo criterio que ProductDetailPage).
 */
export function ProductDetailSheet({
  product,
  tenantSlug,
  onClose,
  onAddedToCart,
}: ProductDetailSheetProps) {
  const [visible, setVisible] = useState(false);

  // Triggerear la animación de entrada en el próximo frame
  useEffect(() => {
    const raf = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 280);
  }

  const props: SheetContentProps = {
    product,
    tenantSlug,
    onClose: handleClose,
    onAddedToCart,
  };

  let content: React.ReactNode;
  switch (product.type) {
    case "physical":
      content = product.variants_enabled ? (
        <RetailSheetContent {...props} />
      ) : (
        <SimpleSheetContent {...props} />
      );
      break;
    case "prepared":
      content = <FoodSheetContent {...props} />;
      break;
    case "service":
      content = <BookingSheetContent {...props} />;
      break;
    case "labor":
      content = <ServiceSheetContent {...props} />;
      break;
    default:
      content = <SimpleSheetContent {...props} />;
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/50" onClick={handleClose} />

      {/* Panel */}
      <div
        className={clsx(
          "fixed bottom-0 inset-x-0 z-50 bg-white rounded-t-2xl flex flex-col max-h-[90vh]",
          "transition-transform duration-300",
          visible ? "translate-y-0" : "translate-y-full",
        )}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-gray-300" />
        </div>

        {/* Botón cerrar */}
        <button
          onClick={handleClose}
          className="absolute top-3 right-4 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 text-gray-500 text-base"
          aria-label="Cerrar"
        >
          ✕
        </button>

        {/* Contenido adaptativo */}
        {content}
      </div>
    </>
  );
}

// ─── Props compartidos entre sub-vistas del sheet ─────────────────────────────
interface SheetContentProps {
  product: PublicProduct;
  tenantSlug: string;
  onClose: () => void;
  onAddedToCart?: () => void;
}

// ─── Imagen dentro del sheet ──────────────────────────────────────────────────
function SheetImage({ src, alt }: { src: string | null; alt: string }) {
  return (
    <div className="h-64 sm:h-80 lg:h-[420px] w-full bg-gray-100 flex items-center justify-center overflow-hidden shrink-0">
      {src ? (
        <img
          src={src}
          alt={alt}
          className="max-w-full max-h-full object-contain"
        />
      ) : (
        <svg
          className="w-10 h-10 text-gray-300"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.2}
          viewBox="0 0 24 24"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="M21 15l-5-5L5 21" />
        </svg>
      )}
    </div>
  );
}

// ─── Selector de cantidad ─────────────────────────────────────────────────────
function QtySelector({
  qty,
  onChange,
}: {
  qty: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2.5 border border-gray-200">
      <button
        onClick={() => onChange(Math.max(1, qty - 1))}
        className="w-8 h-8 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-600 text-lg font-medium"
      >
        −
      </button>
      <span className="text-base font-bold text-gray-900 min-w-[24px] text-center">
        {qty}
      </span>
      <button
        onClick={() => onChange(qty + 1)}
        className="w-8 h-8 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-600 text-lg font-medium"
      >
        +
      </button>
    </div>
  );
}

// ─── CTA sticky al fondo del sheet ───────────────────────────────────────────
function SheetCTA({
  label,
  price,
  onClick,
  disabled = false,
}: {
  label: string;
  price?: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="shrink-0 border-t border-gray-100 px-4 py-3 bg-white">
      <button
        onClick={onClick}
        disabled={disabled}
        className="w-full py-4 rounded-xl text-white font-bold text-[15px] disabled:opacity-40 transition-opacity"
        style={{ backgroundColor: "var(--color-primary, #111827)" }}
      >
        {label}
        {price !== undefined ? ` — $${price.toFixed(2)}` : ""}
      </button>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h} hr${h > 1 ? "s" : ""}`;
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. RETAIL — galería, talla, color, variantes
// ═════════════════════════════════════════════════════════════════════════════
function RetailSheetContent({
  product,
  onClose,
  onAddedToCart,
}: SheetContentProps) {
  const [selectedVariant, setSelectedVariant] = useState<string | null>(
    product.variants?.[0]?._id ?? null,
  );
  const [qty, setQty] = useState(1);
  const { addItem } = useCartStore();

  const colorOptions = [
    ...new Set(
      product.variants
        ?.map((v) => v.options["color"] ?? v.options["Color"])
        .filter(Boolean) ?? [],
    ),
  ];
  const sizeOptions = [
    ...new Set(
      product.variants
        ?.map(
          (v) => v.options["talla"] ?? v.options["Talla"] ?? v.options["size"],
        )
        .filter(Boolean) ?? [],
    ),
  ];

  const activeVariant = product.variants?.find(
    (v) => v._id === selectedVariant,
  );
  const effectivePrice = activeVariant?.price_override ?? product.price;
  const inStock =
    !product.stock_enabled ||
    (activeVariant?.stock_qty ?? product.stock_qty) > 0;

  function handleAdd() {
    for (let i = 0; i < qty; i++) {
      addItem({
        productId: product._id,
        productName: product.name,
        productType: product.type,
        unitPrice: effectivePrice,
        variant: activeVariant
          ? { name: activeVariant.name, options: activeVariant.options }
          : null,
      });
    }
    toast.success("Agregado al carrito");
    onAddedToCart?.();
    onClose();
  }

  return (
    <>
      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <SheetImage src={product.image_url} alt={product.name} />

        <div className="px-4 pt-4 pb-2 space-y-4">
          {/* Nombre + precio */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {product.name}
              </h2>
              {product.stock_enabled &&
                product.stock_qty <= 5 &&
                product.stock_qty > 0 && (
                  <p className="text-xs text-amber-600 font-medium mt-0.5">
                    ⚠ Solo {product.stock_qty} en stock
                  </p>
                )}
              {!inStock && (
                <p className="text-xs text-red-500 font-medium mt-0.5">
                  Sin stock
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p
                className="text-lg font-bold"
                style={{ color: "var(--color-primary)" }}
              >
                ${effectivePrice.toFixed(2)}
              </p>
              {product.compare_price && (
                <p className="text-sm text-gray-400 line-through">
                  ${product.compare_price.toFixed(2)}
                </p>
              )}
            </div>
          </div>

          {/* Color selector */}
          {colorOptions.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Color</p>
              <div className="flex gap-2 flex-wrap">
                {colorOptions.map((color) => (
                  <button
                    key={color}
                    className="px-3 py-1.5 rounded-lg text-sm border transition-all"
                    style={{
                      borderColor: "var(--color-primary)",
                      background: "transparent",
                      color: "var(--color-primary)",
                      fontWeight: 600,
                    }}
                  >
                    {color}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Talla selector */}
          {sizeOptions.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs text-gray-500">Talla</p>
                <button
                  className="text-xs underline"
                  style={{ color: "var(--color-primary)" }}
                >
                  Guía de talles
                </button>
              </div>
              <div className="flex gap-2 flex-wrap">
                {sizeOptions.map((size) => {
                  const variant = product.variants?.find((v) =>
                    Object.values(v.options).includes(size),
                  );
                  const hasStock = !variant || (variant.stock_qty ?? 1) > 0;
                  return (
                    <button
                      key={size}
                      disabled={!hasStock}
                      onClick={() => variant && setSelectedVariant(variant._id)}
                      className={clsx(
                        "w-11 h-11 rounded-lg border text-sm font-medium transition-all",
                        !hasStock &&
                          "opacity-30 line-through cursor-not-allowed",
                        selectedVariant === variant?._id
                          ? "text-white border-transparent"
                          : "bg-white text-gray-700 border-gray-200 hover:border-gray-400",
                      )}
                      style={
                        selectedVariant === variant?._id
                          ? {
                              backgroundColor: "var(--color-primary)",
                              borderColor: "var(--color-primary)",
                            }
                          : undefined
                      }
                    >
                      {size}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Descripción */}
          {product.description && (
            <p className="text-sm text-gray-500 leading-relaxed">
              {product.description}
            </p>
          )}

          {/* Cantidad */}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Cantidad</p>
            <QtySelector qty={qty} onChange={setQty} />
          </div>
        </div>
      </div>

      <SheetCTA
        label="Agregar al carrito"
        price={effectivePrice * qty}
        onClick={handleAdd}
        disabled={!inStock}
      />
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. SIMPLE — retail sin variantes
// ═════════════════════════════════════════════════════════════════════════════
function SimpleSheetContent({
  product,
  onClose,
  onAddedToCart,
}: SheetContentProps) {
  const [qty, setQty] = useState(1);
  const { addItem } = useCartStore();
  const inStock = !product.stock_enabled || product.stock_qty > 0;

  function handleAdd() {
    for (let i = 0; i < qty; i++) {
      addItem({
        productId: product._id,
        productName: product.name,
        productType: product.type,
        unitPrice: product.price,
      });
    }
    toast.success("Agregado al carrito");
    onAddedToCart?.();
    onClose();
  }

  return (
    <>
      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <SheetImage src={product.image_url} alt={product.name} />

        <div className="px-4 pt-4 pb-2 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <h2 className="text-lg font-bold text-gray-900">{product.name}</h2>
            <p
              className="text-lg font-bold shrink-0"
              style={{ color: "var(--color-primary)" }}
            >
              ${product.price.toFixed(2)}
            </p>
          </div>
          {product.description && (
            <p className="text-sm text-gray-500 leading-relaxed">
              {product.description}
            </p>
          )}
          {product.stock_enabled && (
            <p
              className={clsx(
                "text-xs font-medium",
                inStock ? "text-green-600" : "text-red-500",
              )}
            >
              {inStock
                ? `✓ Stock disponible (${product.stock_qty} unid.)`
                : "✗ Sin stock"}
            </p>
          )}
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-gray-700">Cantidad</p>
            <QtySelector qty={qty} onChange={setQty} />
          </div>
        </div>
      </div>

      <SheetCTA
        label="Agregar al carrito"
        price={product.price * qty}
        onClick={handleAdd}
        disabled={!inStock}
      />
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. FOOD — modificadores, extras, notas
// ═════════════════════════════════════════════════════════════════════════════
function FoodSheetContent({
  product,
  onClose,
  onAddedToCart,
}: SheetContentProps) {
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [selectedMods, setSelectedMods] = useState<Record<string, string[]>>(
    {},
  );
  const { addItem } = useCartStore();

  const modifiersTotal = Object.entries(selectedMods).reduce(
    (sum, [modId, optNames]) => {
      const mod = product.modifiers?.find((m) => m._id === modId);
      return (
        sum +
        (mod?.options
          .filter((o) => optNames.includes(o.name))
          .reduce((s, o) => s + o.price_extra, 0) ?? 0)
      );
    },
    0,
  );

  const total = (product.price + modifiersTotal) * qty;

  function toggleMod(
    modId: string,
    optName: string,
    type: "single" | "multiple",
  ) {
    setSelectedMods((prev) => {
      const current = prev[modId] ?? [];
      if (type === "single") return { ...prev, [modId]: [optName] };
      return {
        ...prev,
        [modId]: current.includes(optName)
          ? current.filter((o) => o !== optName)
          : [...current, optName],
      };
    });
  }

  const requiredMods = product.modifiers?.filter((m) => m.required) ?? [];
  const canAdd = requiredMods.every(
    (m) => (selectedMods[m._id]?.length ?? 0) > 0,
  );

  function handleAdd() {
    const modifiers = Object.entries(selectedMods).flatMap(([modId, opts]) => {
      const mod = product.modifiers?.find((m) => m._id === modId);
      return opts.map((optName) => ({
        name: mod?.name ?? "",
        option: optName,
        price_extra:
          mod?.options.find((o) => o.name === optName)?.price_extra ?? 0,
      }));
    });
    for (let i = 0; i < qty; i++) {
      addItem({
        productId: product._id,
        productName: product.name,
        productType: "prepared",
        unitPrice: product.price + modifiersTotal,
        modifiers,
        notes: notes || undefined,
      });
    }
    toast.success("Agregado al pedido");
    onAddedToCart?.();
    onClose();
  }

  return (
    <>
      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <SheetImage src={product.image_url} alt={product.name} />

        <div className="px-4 pt-4 pb-2 space-y-3">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {product.name}
              </h2>
              {product.description && (
                <p className="text-sm text-gray-500 mt-1 leading-snug">
                  {product.description}
                </p>
              )}
              <div className="flex items-center gap-3 mt-1.5">
                <span
                  className="text-base font-bold"
                  style={{ color: "var(--color-primary)" }}
                >
                  ${product.price.toFixed(2)}
                </span>
                {product.prep_time_minutes && (
                  <span className="text-xs text-gray-400">
                    ⏱ {product.prep_time_minutes} min
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Modificadores */}
          {product.modifiers?.map((mod) => (
            <div
              key={mod._id}
              className="bg-gray-50 rounded-xl overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-900">
                    {mod.name}
                  </p>
                  {mod.required ? (
                    <span className="text-[10px] bg-red-50 text-red-500 px-2 py-0.5 rounded-full font-semibold">
                      Requerido
                    </span>
                  ) : (
                    <span className="text-[10px] text-gray-400">Opcional</span>
                  )}
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {mod.type === "single"
                    ? "Elegí una opción"
                    : "Podés elegir varias"}
                </p>
              </div>
              <div className="divide-y divide-gray-100">
                {mod.options.map((opt) => {
                  const isSelected = selectedMods[mod._id]?.includes(opt.name);
                  return (
                    <label
                      key={opt.name}
                      className="flex items-center justify-between px-4 py-3 cursor-pointer bg-white"
                      onClick={() => toggleMod(mod._id, opt.name, mod.type)}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={clsx(
                            "w-5 h-5 border-2 flex items-center justify-center shrink-0",
                            mod.type === "single" ? "rounded-full" : "rounded",
                            isSelected
                              ? "border-transparent"
                              : "border-gray-300 bg-white",
                          )}
                          style={
                            isSelected
                              ? {
                                  backgroundColor: "var(--color-primary)",
                                  borderColor: "var(--color-primary)",
                                }
                              : undefined
                          }
                        >
                          {isSelected && (
                            <span className="text-white text-xs font-bold">
                              {mod.type === "single" ? "●" : "✓"}
                            </span>
                          )}
                        </div>
                        <span className="text-sm text-gray-800">
                          {opt.name}
                        </span>
                      </div>
                      {opt.price_extra > 0 && (
                        <span className="text-sm text-gray-500">
                          + ${opt.price_extra.toFixed(2)}
                        </span>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>
          ))}

          {/* Notas */}
          <div className="bg-gray-50 rounded-xl px-4 py-3">
            <p className="text-sm font-medium text-gray-700 mb-2">
              Notas especiales
            </p>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Sin cebolla, sin tomate..."
              rows={2}
              className="w-full text-sm text-gray-700 resize-none outline-none placeholder-gray-300 leading-relaxed bg-transparent"
            />
          </div>

          {/* Cantidad */}
          <div className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3">
            <p className="text-sm font-medium text-gray-700">Cantidad</p>
            <QtySelector qty={qty} onChange={setQty} />
          </div>
        </div>
      </div>

      <SheetCTA
        label="Agregar al pedido"
        price={total}
        onClick={handleAdd}
        disabled={!canAdd}
      />
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. BOOKING — info del servicio, reservar turno
// ═════════════════════════════════════════════════════════════════════════════
function BookingSheetContent({
  product,
  tenantSlug,
  onClose,
}: SheetContentProps) {
  const navigate = useNavigate();

  function handleReserve() {
    navigate(`/${tenantSlug}/reservar/${product._id}`);
    onClose();
  }

  return (
    <>
      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <SheetImage src={product.image_url} alt={product.name} />

        <div className="px-4 pt-4 pb-2 space-y-4">
          {/* Info */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {product.name}
              </h2>
              {product.description && (
                <p className="text-sm text-gray-500 mt-1 leading-snug">
                  {product.description}
                </p>
              )}
            </div>
            <div className="text-right shrink-0">
              <p
                className="text-lg font-bold"
                style={{ color: "var(--color-primary)" }}
              >
                ${product.price.toFixed(2)}
              </p>
              {product.duration_minutes && (
                <p className="text-xs text-gray-400">
                  {formatDuration(product.duration_minutes)}
                </p>
              )}
            </div>
          </div>

          {/* Info chips */}
          <div className="flex gap-3">
            {product.duration_minutes && (
              <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-base">⏱</p>
                <p className="text-xs text-gray-400 mt-0.5">Duración</p>
                <p className="text-sm font-semibold text-gray-900">
                  {formatDuration(product.duration_minutes)}
                </p>
              </div>
            )}
            <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-base">📍</p>
              <p className="text-xs text-gray-400 mt-0.5">Modalidad</p>
              <p className="text-sm font-semibold text-gray-900">Presencial</p>
            </div>
            <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-base">💰</p>
              <p className="text-xs text-gray-400 mt-0.5">Precio</p>
              <p className="text-sm font-semibold text-gray-900">
                ${product.price.toFixed(2)}
              </p>
            </div>
          </div>
        </div>
      </div>

      <SheetCTA label="Reservar turno" onClick={handleReserve} />
    </>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. SERVICE — descripción problema, solicitar cotización
// ═════════════════════════════════════════════════════════════════════════════
function ServiceSheetContent({
  product,
  tenantSlug,
  onClose,
}: SheetContentProps) {
  const navigate = useNavigate();
  const [desc, setDesc] = useState("");

  function handleQuote() {
    navigate(
      `/${tenantSlug}/reservar/${product._id}?desc=${encodeURIComponent(desc)}`,
    );
    onClose();
  }

  return (
    <>
      {/* Scrollable */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-2 space-y-4">
          {/* Header */}
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-green-50 flex items-center justify-center shrink-0">
              <svg
                className="w-7 h-7"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.8}
                viewBox="0 0 24 24"
                style={{ color: "var(--color-primary, #0F766E)" }}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">
                {product.name}
              </h2>
              {product.description && (
                <p className="text-sm text-gray-500 mt-0.5 leading-snug">
                  {product.description}
                </p>
              )}
              <p
                className="text-base font-bold mt-1"
                style={{ color: "var(--color-primary)" }}
              >
                Desde ${product.price.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Info chips */}
          <div className="flex gap-3">
            {product.duration_minutes && (
              <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400">Duración</p>
                <p className="text-sm font-semibold text-gray-900">
                  {formatDuration(product.duration_minutes)}
                </p>
              </div>
            )}
            <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400">Modalidad</p>
              <p className="text-sm font-semibold text-gray-900">A domicilio</p>
            </div>
            <div className="flex-1 bg-gray-50 rounded-xl p-3 text-center">
              <p className="text-xs text-gray-400">Cotización</p>
              <p className="text-sm font-semibold text-green-600">Gratis</p>
            </div>
          </div>

          {/* Descripción del problema */}
          <div className="bg-gray-50 rounded-xl px-4 py-4">
            <p className="text-sm font-semibold text-gray-900 mb-1">
              Describí el problema <span className="text-red-400">*</span>
            </p>
            <p className="text-xs text-gray-400 mb-3">
              El técnico revisará tu descripción para darte un presupuesto.
            </p>
            <textarea
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="Ej: Mi laptop no enciende, la conecté a la corriente y no hace nada..."
              rows={4}
              className="w-full text-sm text-gray-700 border border-gray-200 rounded-lg px-3 py-2.5 outline-none resize-none focus:ring-2 leading-relaxed bg-white"
              style={
                {
                  "--tw-ring-color": "var(--color-primary)",
                } as React.CSSProperties
              }
            />
          </div>
        </div>
      </div>

      <SheetCTA
        label="Solicitar cotización gratuita"
        onClick={handleQuote}
        disabled={desc.trim().length < 10}
      />
    </>
  );
}
