import clsx from "clsx";
import { PublicProduct } from "@foodorder/types";
import { useCartStore } from "../../stores/cart.store";
import { formatBs, formatBsApprox, usdToBs } from "../../lib/money";

interface ProductCardProps {
  product: PublicProduct;
  onAction: (product: PublicProduct) => void;
  disabled?: boolean;
  readOnly?: boolean;
  currencyMode?: "usd" | "bs";
  usdRate?: number | null;
}

/**
 * ProductCard — componente genérico que adapta su UI según product.type.
 *
 * type="physical"  → retail: imagen + variantes + stock badge
 * type="prepared"  → food: imagen + tiempo de prep
 * type="service"   → booking: avatar + duración + "Reservar"
 * type="labor"     → service: ícono + precio desde + "Cotizar"
 *
 * Colores via CSS custom properties del tenant (--color-primary).
 */
export function ProductCard({
  product,
  onAction,
  disabled = false,
  readOnly = false,
  currencyMode = "usd",
  usdRate = null,
}: ProductCardProps) {
  const outOfStock = product.stock_enabled && product.stock_qty <= 0;
  const isDisabled = disabled || outOfStock;
  const qty = useCartStore((s) =>
    s.items
      .filter((i) => i.productId === product._id)
      .reduce((sum, i) => sum + i.quantity, 0),
  );
  const updateQty = useCartStore((s) => s.updateQty);

  const bsPrice = usdRate !== null ? usdToBs(product.price, usdRate) : null;
  const primaryPrice =
    currencyMode === "bs" && bsPrice !== null
      ? formatBs(bsPrice)
      : formatPrice(product.price);
  const secondaryPrice =
    currencyMode === "bs"
      ? formatPrice(product.price)
      : bsPrice !== null
        ? formatBsApprox(product.price, usdRate!)
        : null;

  const ctaLabel =
    {
      physical: "+",
      prepared: "+",
      service: "Reservar",
      labor: "Cotizar",
    }[product.type] ?? "+";

  const ctaWide = product.type === "service" || product.type === "labor";

  return (
    <div className="bg-white rounded-[var(--radius-md,10px)] shadow-sm flex items-center gap-3 p-3">
      {/* Imagen / Avatar / Ícono */}
      <ProductCardMedia product={product} />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900 text-sm truncate">
            {product.name}
          </h3>
          {outOfStock && (
            <span className="text-[10px] bg-red-50 text-red-500 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
              Agotado
            </span>
          )}
          {product.compare_price && (
            <span className="text-[10px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded-full font-semibold shrink-0">
              Oferta
            </span>
          )}
        </div>

        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-snug">
          {product.description}
        </p>

        <div className="flex items-center gap-2 mt-1">
          <div>
            <span
              className="text-sm font-bold"
              style={{ color: "var(--color-primary, #111827)" }}
            >
              {primaryPrice}
            </span>
            {secondaryPrice && (
              <span className="block text-[11px] text-gray-400 leading-none mt-0.5">
                {secondaryPrice}
              </span>
            )}
          </div>
          {product.compare_price && (
            <span className="text-xs text-gray-400 line-through">
              {formatPrice(product.compare_price)}
            </span>
          )}
          <ProductCardMeta product={product} />
        </div>

        {/* Variantes (retail) */}
        {product.type === "physical" &&
          product.variants_enabled &&
          product.variants &&
          product.variants.length > 0 && (
            <div className="flex gap-1 mt-1.5 flex-wrap">
              {getVariantOptions(product)
                .slice(0, 4)
                .map((opt) => (
                  <span
                    key={opt}
                    className="text-[10px] border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded"
                  >
                    {opt}
                  </span>
                ))}
            </div>
          )}
      </div>

      {/* CTA */}
      {!readOnly &&
        (qty > 0 && !ctaWide ? (
          <div
            className="shrink-0 flex items-center rounded-full overflow-hidden"
            style={{ backgroundColor: "var(--color-primary, #111827)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={() => updateQty(product._id, qty - 1)}
              className="w-8 h-9 flex items-center justify-center text-lg font-bold active:opacity-60 transition-opacity"
              style={{ color: "var(--color-primary-fg, #fff)" }}
              aria-label={`Quitar ${product.name}`}
            >
              −
            </button>
            <span
              className="min-w-[1.25rem] text-center text-sm font-bold tabular-nums"
              style={{ color: "var(--color-primary-fg, #fff)" }}
            >
              {qty}
            </span>
            <button
              onClick={() => !isDisabled && onAction(product)}
              className="w-8 h-9 flex items-center justify-center text-lg font-bold active:opacity-60 transition-opacity"
              style={{ color: "var(--color-primary-fg, #fff)" }}
              aria-label={`Agregar ${product.name}`}
            >
              +
            </button>
          </div>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation();
              !isDisabled && onAction(product);
            }}
            disabled={isDisabled}
            className={clsx(
              "shrink-0 flex items-center justify-center font-bold transition-all active:scale-90",
              ctaWide
                ? "h-8 px-3 rounded-[var(--radius-sm,6px)] text-xs"
                : "w-9 h-9 rounded-full text-xl",
              isDisabled ? "opacity-30 cursor-not-allowed" : "cursor-pointer",
            )}
            style={{
              backgroundColor: "var(--color-primary, #111827)",
              color: "var(--color-primary-fg, #fff)",
            }}
            aria-label={`${ctaLabel} ${product.name}`}
          >
            {ctaLabel}
          </button>
        ))}
    </div>
  );
}

// ─── Sub-componentes internos ─────────────────────────────────────────────────

function ProductCardMedia({ product }: { product: PublicProduct }) {
  if (product.type === "service") {
    return (
      <div className="w-12 h-12 rounded-full bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <svg
            className="w-5 h-5 text-gray-400"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.5}
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="8" r="3.5" />
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
          </svg>
        )}
      </div>
    );
  }

  if (product.type === "labor") {
    return (
      <div className="w-11 h-11 rounded-lg bg-gray-50 shrink-0 flex items-center justify-center">
        <svg
          className="w-5 h-5 text-gray-400"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
          />
        </svg>
      </div>
    );
  }

  // physical + prepared
  return (
    <div className="w-16 h-16 rounded-lg bg-gray-100 shrink-0 overflow-hidden flex items-center justify-center">
      {product.image_url ? (
        <img
          src={product.image_url}
          alt={product.name}
          className="w-full h-full object-cover"
        />
      ) : (
        <svg
          className="w-5 h-5 text-gray-300"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
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

function ProductCardMeta({ product }: { product: PublicProduct }) {
  if (product.type === "prepared" && product.prep_time_minutes) {
    return (
      <span className="text-[11px] text-gray-400">
        · ⏱ {product.prep_time_minutes} min
      </span>
    );
  }
  if (
    (product.type === "service" || product.type === "labor") &&
    product.duration_minutes
  ) {
    return (
      <span className="text-[11px] text-gray-400">
        · {formatDuration(product.duration_minutes)}
      </span>
    );
  }
  if (product.type === "physical" && product.stock_enabled) {
    return (
      <span className="text-[11px] text-gray-400">
        · Stock: {product.stock_qty}
      </span>
    );
  }
  return null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatPrice(price: number): string {
  return `$${price.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}min` : `${h} hr${h > 1 ? "s" : ""}`;
}

function getVariantOptions(product: PublicProduct): string[] {
  if (!product.variants) return [];
  const allOptions = new Set<string>();
  product.variants.forEach((v) => {
    Object.values(v.options).forEach((val) => allOptions.add(val));
  });
  return Array.from(allOptions);
}
