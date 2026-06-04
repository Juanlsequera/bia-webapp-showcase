import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PublicProduct, TenantPublic } from "@foodorder/types";
import { api } from "../../lib/api";
import { applyTenantTheme, getTenantCapabilities } from "../../lib/tenant";
import { useCartStore } from "../../stores/cart.store";
import { useCartPersistence } from "../../lib/use-cart-persistence";
import { formatBs, usdToBs } from "../../lib/money";
import { ProductCard } from "../../components/ui/ProductCard";
import { CategoryPills } from "../../components/ui/CategoryPills";
import { ProductDetailSheet } from "../../components/ui/ProductDetailSheet";
import { SocialBar } from "../../components/SocialBar";
import { WhatsAppFAB } from "../../components/WhatsAppFAB";

interface CatalogPageProps {
  /** true cuando la ruta es /:slug/llevar — activa el modo takeaway en el carrito */
  takeaway?: boolean;
  /** true cuando la ruta es /:slug/catalogo — solo consulta, sin carrito ni compra */
  readOnly?: boolean;
}

/**
 * CatalogPage — pantalla de catálogo genérica.
 * Adapta layout y comportamiento según el arquetipo del tenant.
 *
 * Cambios vs versión anterior:
 * - Cards ahora son CLICKABLES → navegan a /producto/:productId
 * - Booking/Service: el click va directo al detalle, sin agregar al carrito
 * - Retail con variantes: click abre detalle para seleccionar talla/color
 * - Food: click abre detalle para seleccionar modificadores
 * - Grid mode para retail (2 columnas) vs list mode para food/service
 */
export function CatalogPage({
  takeaway = false,
  readOnly = false,
}: CatalogPageProps) {
  const { tenantSlug, tableNumber } = useParams<{
    tenantSlug: string;
    tableNumber?: string;
  }>();
  const { addItem, setTable, setTenant, setTakeaway } = useCartStore();
  const cartCount = useCartStore((s) => s.count());
  const [cartBounce, setCartBounce] = useState(false);
  const prevCartCount = useRef(0);

  const [selectedProduct, setSelectedProduct] = useState<PublicProduct | null>(
    null,
  );
  const [currencyMode, setCurrencyMode] = useState<"usd" | "bs">("usd");

  // P2.3 — sincronizar carrito con Redis (restore si el cliente vuelve a escanear el QR)
  useCartPersistence(tableNumber);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // ── Tenant ─────────────────────────────────────────────────────────────────
  const { data: tenant } = useQuery<TenantPublic>({
    queryKey: ["tenant", tenantSlug],
    queryFn: async () => (await api.get(`/tenants/${tenantSlug}/public`)).data,
    enabled: !!tenantSlug,
  });

  useEffect(() => {
    if (!tenant) return;
    applyTenantTheme(tenant.theme);

    if (tenantSlug && tableNumber) setTable(tenantSlug, Number(tableNumber));
    else if (tenantSlug && takeaway) setTakeaway(tenantSlug);
    else if (tenantSlug) setTenant(tenantSlug);
  }, [tenant, tenantSlug, tableNumber, takeaway]);

  useEffect(() => {
    if (cartCount > prevCartCount.current) {
      setCartBounce(true);
      const t = setTimeout(() => setCartBounce(false), 450);
      prevCartCount.current = cartCount;
      return () => clearTimeout(t);
    }
    prevCartCount.current = cartCount;
  }, [cartCount]);

  // ── Catálogo ───────────────────────────────────────────────────────────────
  const { data: products = [], isLoading } = useQuery<PublicProduct[]>({
    queryKey: ["catalog", tenantSlug],
    queryFn: async () => (await api.get(`/${tenantSlug}/catalog`)).data,
    enabled: !!tenantSlug,
  });

  // ── Derived state ──────────────────────────────────────────────────────────
  const caps = getTenantCapabilities(tenant ?? null);
  const showCart = !readOnly && caps.hasCart;
  const showSearch = caps.hasSearch;
  const hasCover = !!tenant?.cover_url;
  // Grid 2 columnas para retail y food; booking/service siguen en lista
  const usdRate = tenant?.usdRate?.value ?? null;
  const heroLayout =
    tenant?.theme?.hero_layout ?? (hasCover ? "cover" : "brand");
  const showBrandHero = heroLayout === "brand";
  const showCoverHero = heroLayout === "cover" && hasCover;
  const tagline = tenant?.theme?.tagline ?? "";
  // menu_layout override: si el tenant lo configuró, úsalo; si no, default por arquetipo
  const defaultGrid = caps.hasCart;
  const useGrid = tenant?.theme?.menu_layout
    ? tenant.theme.menu_layout === "grid"
    : defaultGrid;

  const categories = [...new Set(products.map((p) => p.category))];

  const filtered = products.filter((p) => {
    const matchCat = !activeCategory || p.category === activeCategory;
    const matchSearch =
      !search || p.name.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const byCategory = filtered.reduce<Record<string, PublicProduct[]>>(
    (acc, p) => {
      if (!acc[p.category]) acc[p.category] = [];
      acc[p.category].push(p);
      return acc;
    },
    {},
  );

  // ── Handlers ───────────────────────────────────────────────────────────────
  /**
   * Click en el body de una card → abre siempre el sheet (salvo readOnly).
   */
  function handleCardBodyClick(product: PublicProduct) {
    if (readOnly) return;
    setSelectedProduct(product);
  }

  /**
   * Click en el botón + de una card:
   * - Productos simples sin opciones → agrega directo al carrito
   * - Productos complejos (variantes, modificadores, booking, service) → abre el sheet
   */
  function handleCardAction(product: PublicProduct) {
    if (readOnly) return;
    const needsSheet =
      !caps.hasCart ||
      product.type === "service" ||
      product.type === "labor" ||
      (product.type === "physical" && product.variants_enabled) ||
      (product.type === "prepared" && (product.modifiers?.length ?? 0) > 0);

    if (needsSheet) {
      setSelectedProduct(product);
    } else {
      addItem({
        productId: product._id,
        productName: product.name,
        productType: product.type,
        unitPrice: product.price,
      });
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <p className="text-gray-400 text-sm">Cargando catálogo...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Hero: portada con foto ────────────────────────────────────────── */}
      {showCoverHero && (
        <div className="relative h-48 overflow-hidden">
          <img
            src={tenant!.cover_url!}
            alt=""
            aria-hidden
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/10 to-black/55" />
          <div className="absolute bottom-0 left-0 right-0 px-4 pb-3 max-w-lg mx-auto flex items-end gap-3">
            {tenant?.logo_url && (
              <img
                src={tenant.logo_url}
                alt={tenant.name}
                className="w-12 h-12 rounded-xl object-cover ring-2 ring-white/40 flex-shrink-0 shadow-lg"
              />
            )}
            <div className="min-w-0">
              <p className="text-white font-bold text-xl leading-tight drop-shadow truncate">
                {tenant!.name}
              </p>
              {tagline && (
                <p className="text-white/75 text-xs mt-0.5 truncate">
                  {tagline}
                </p>
              )}
              {tableNumber && (
                <span className="text-white/70 text-xs font-medium">
                  Mesa {tableNumber}
                </span>
              )}
              {takeaway && (
                <span className="text-white/70 text-xs font-medium">
                  Para llevar
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Hero: marca con color primario ───────────────────────────────── */}
      {showBrandHero && (
        <div
          className="relative overflow-hidden"
          style={{ backgroundColor: "var(--color-primary)" }}
        >
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(135deg, rgba(0,0,0,0.08) 0%, rgba(0,0,0,0.28) 100%)",
            }}
          />
          <div className="relative max-w-lg mx-auto px-4 py-5 flex items-center gap-4">
            {tenant?.logo_url ? (
              <img
                src={tenant.logo_url}
                alt={tenant.name}
                className="w-14 h-14 rounded-2xl object-cover flex-shrink-0 shadow-lg ring-2 ring-white/20"
              />
            ) : (
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0 text-white font-black text-2xl select-none shadow-lg"
                style={{
                  background: "rgba(255,255,255,0.22)",
                  border: "2px solid rgba(255,255,255,0.35)",
                }}
              >
                {tenant?.name.charAt(0).toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-white font-black text-xl leading-tight drop-shadow-sm truncate">
                {tenant?.name}
              </p>
              {tagline && (
                <p className="text-white/75 text-xs mt-0.5 truncate">
                  {tagline}
                </p>
              )}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {tableNumber && (
                  <span className="text-white/70 text-xs font-medium">
                    Mesa {tableNumber}
                  </span>
                )}
                {takeaway && (
                  <span className="text-white/70 text-xs font-medium">
                    🥡 Para llevar
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Strip de redes sociales */}
      {tenant?.contact && <SocialBar contact={tenant.contact} />}

      {/* ── Header sticky — banda de marca ──────────────────────────────── */}
      <header className="sticky top-0 z-10">
        <div
          className="px-4 py-3"
          style={{ backgroundColor: "var(--color-primary, #111827)" }}
        >
          <div className="max-w-lg sm:max-w-2xl lg:max-w-5xl mx-auto flex items-center justify-between gap-3">
            {/* Logo + nombre + mesa */}
            <div className="flex items-center gap-3 min-w-0">
              {!showBrandHero && !showCoverHero && tenant?.logo_url && (
                <img
                  src={tenant.logo_url}
                  alt={tenant.name}
                  className="h-10 w-10 object-cover rounded-xl bg-white/15 flex-shrink-0"
                />
              )}
              <div className="min-w-0">
                <p
                  className="text-base font-bold leading-tight truncate"
                  style={{ color: "var(--color-primary-fg, #fff)" }}
                >
                  {tenant?.name ?? tenantSlug}
                </p>
                {!showBrandHero && !showCoverHero && tableNumber && (
                  <span
                    className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/20 mt-0.5"
                    style={{ color: "var(--color-primary-fg, #fff)" }}
                  >
                    Mesa {tableNumber}
                  </span>
                )}
              </div>
            </div>

            {/* Toggle USD|Bs + Carrito — siempre agrupados a la derecha */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {usdRate !== null && (
                <button
                  onClick={() =>
                    setCurrencyMode((m) => (m === "usd" ? "bs" : "usd"))
                  }
                  title={`Tasa BCV: $1 = Bs. ${usdRate.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  className="flex items-center gap-0.5 text-xs font-bold px-2.5 py-1.5 rounded-full border border-white/40 bg-white/10 hover:bg-white/20 transition-colors active:scale-95"
                  style={{ color: "var(--color-primary-fg, #fff)" }}
                >
                  <span style={{ opacity: currencyMode === "usd" ? 1 : 0.45 }}>
                    USD
                  </span>
                  <span className="mx-0.5 opacity-30">|</span>
                  <span style={{ opacity: currencyMode === "bs" ? 1 : 0.45 }}>
                    Bs.
                  </span>
                </button>
              )}

              {showCart && (
                <a
                  href={`/${tenantSlug}/carrito`}
                  className={`flex items-center gap-2 text-sm font-semibold px-3.5 py-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors${cartBounce ? " cart-bounce" : ""}`}
                  style={{ color: "var(--color-primary-fg, #fff)" }}
                >
                  <svg
                    className="w-5 h-5 shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    strokeWidth={2}
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
                    />
                  </svg>
                  <span className="hidden sm:inline">Carrito</span>
                  {cartCount > 0 && (
                    <span
                      className="bg-white rounded-full min-w-[20px] h-5 flex items-center justify-center text-[11px] font-bold px-1"
                      style={{ color: "var(--color-primary, #111827)" }}
                    >
                      {cartCount}
                    </span>
                  )}
                </a>
              )}
            </div>
          </div>

          {/* Buscador (retail) */}
          {showSearch && (
            <div className="max-w-lg sm:max-w-2xl lg:max-w-5xl mx-auto mt-2.5">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar productos..."
                className="w-full bg-white/20 rounded-xl px-4 py-2.5 text-sm outline-none placeholder-white/60 text-white focus:bg-white/30 transition-colors"
              />
            </div>
          )}
        </div>

        {/* Categorías */}
        {categories.length > 1 && (
          <div className="bg-white border-b border-gray-100 shadow-sm py-2">
            <div className="max-w-lg sm:max-w-2xl lg:max-w-5xl mx-auto">
              <CategoryPills
                categories={categories}
                active={activeCategory}
                onChange={setActiveCategory}
              />
            </div>
          </div>
        )}
      </header>

      {/* ── Catálogo ───────────────────────────────────────────────────────── */}
      <main className="max-w-lg sm:max-w-2xl lg:max-w-5xl mx-auto px-4 py-5 space-y-7">
        {/* Horario del negocio */}
        {tenant?.schedule &&
          (() => {
            const { openHour, closeHour, closedDays, forceClosed } =
              tenant.schedule!;
            const fmt = (h: number) => `${h.toString().padStart(2, "0")}:00`;
            const DAYS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
            const closedLabels = (closedDays ?? [])
              .map((d) => DAYS[d])
              .join(", ");
            return (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs bg-gray-50 border border-gray-100 rounded-xl px-3 py-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${tenant.isOpen ? "bg-emerald-400" : "bg-gray-400"}`}
                />
                <span
                  className={`font-semibold ${tenant.isOpen ? "text-emerald-600" : "text-gray-500"}`}
                >
                  {tenant.isOpen ? "Abierto ahora" : "Cerrado ahora"}
                </span>
                {!forceClosed && (
                  <>
                    <span className="text-gray-300 select-none">·</span>
                    <span className="text-gray-500">
                      {fmt(openHour)} – {fmt(closeHour)}
                    </span>
                    {closedLabels && (
                      <>
                        <span className="text-gray-300 select-none">·</span>
                        <span className="text-gray-400">
                          Cierra: {closedLabels}
                        </span>
                      </>
                    )}
                  </>
                )}
              </div>
            );
          })()}

        {Object.entries(byCategory).map(([category, items]) => (
          <section key={category}>
            <div className="flex items-center gap-2.5 mb-4 pb-2.5 border-b border-gray-200">
              <span
                className="w-1 h-5 rounded-full shrink-0"
                style={{ backgroundColor: "var(--color-primary)" }}
              />
              <h2 className="text-base font-bold text-gray-900">{category}</h2>
            </div>

            {useGrid ? (
              /* Grid responsivo: 2 cols mobile · 3 tablet · 4 desktop */
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {items.map((product) => (
                  <div
                    key={product._id}
                    onClick={() => handleCardBodyClick(product)}
                    className={readOnly ? "" : "cursor-pointer"}
                  >
                    <CatalogGridCard
                      product={product}
                      onCardClick={handleCardAction}
                      readOnly={readOnly}
                      currencyMode={currencyMode}
                      usdRate={usdRate}
                    />
                  </div>
                ))}
              </div>
            ) : (
              /* Lista para food/booking/service */
              <div className="space-y-2.5">
                {items.map((product) => (
                  <div
                    key={product._id}
                    onClick={() => handleCardBodyClick(product)}
                    className={readOnly ? "" : "cursor-pointer"}
                  >
                    <ProductCard
                      product={product}
                      onAction={handleCardAction}
                      readOnly={readOnly}
                      currencyMode={currencyMode}
                      usdRate={usdRate}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No se encontraron productos</p>
          </div>
        )}
      </main>

      {/* ── Footer flotante de carrito ─────────────────────────────────────── */}
      {showCart && cartCount > 0 && (
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-3 pb-safe-4 bg-white border-t border-gray-100 shadow-[0_-4px_16px_rgba(0,0,0,0.08)]">
          <a
            href={`/${tenantSlug}/carrito`}
            className={`flex items-center justify-between w-full max-w-lg sm:max-w-2xl mx-auto px-5 py-3.5 rounded-xl text-white font-semibold${cartBounce ? " cart-bounce" : ""}`}
            style={{ backgroundColor: "var(--color-primary, #111827)" }}
          >
            {/* Izquierda: ícono + badge + texto */}
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <svg
                  className="w-5 h-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z"
                  />
                </svg>
                <span
                  className="absolute -top-2 -right-2 bg-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-0.5 leading-none"
                  style={{ color: "var(--color-primary, #111827)" }}
                >
                  {cartCount}
                </span>
              </div>
              <span>Ver pedido</span>
            </div>

            {/* Derecha: total + flecha */}
            <div className="flex items-center gap-1.5">
              <span className="font-bold">
                ${useCartStore.getState().total().toFixed(2)}
              </span>
              <svg
                className="w-4 h-4 opacity-70"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={2.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m8.25 4.5 7.5 7.5-7.5 7.5"
                />
              </svg>
            </div>
          </a>
        </div>
      )}

      {/* ── Bottom sheet de detalle ───────────────────────────────────────── */}
      {selectedProduct && (
        <ProductDetailSheet
          product={selectedProduct}
          tenantSlug={tenantSlug!}
          onClose={() => setSelectedProduct(null)}
        />
      )}

      {/* ── Botón flotante de WhatsApp ─────────────────────────────────────── */}
      <WhatsAppFAB
        contact={tenant?.contact}
        elevated={showCart && cartCount > 0}
      />
    </div>
  );
}

// ─── CatalogGridCard — tarjeta grid 2col para food (cuadrada) y retail (3/4) ──
function CatalogGridCard({
  product,
  onCardClick,
  readOnly = false,
  currencyMode = "usd",
  usdRate = null,
}: {
  product: PublicProduct;
  onCardClick: (p: PublicProduct) => void;
  readOnly?: boolean;
  currencyMode?: "usd" | "bs";
  usdRate?: number | null;
}) {
  const outOfStock = product.stock_enabled && product.stock_qty <= 0;
  const qty = useCartStore((s) =>
    s.items
      .filter((i) => i.productId === product._id)
      .reduce((sum, i) => sum + i.quantity, 0),
  );
  const updateQty = useCartStore((s) => s.updateQty);

  const bsPrice = usdRate !== null ? usdToBs(product.price, usdRate) : null;
  const displayPrice =
    currencyMode === "bs" && bsPrice !== null
      ? formatBs(bsPrice)
      : `$${product.price.toFixed(2)}`;

  // Food usa imagen cuadrada (como Rappi/UberEats); retail usa portrait 3/4
  const aspectClass =
    product.type === "physical" ? "aspect-[3/4]" : "aspect-square";

  return (
    <div className="bg-white rounded-2xl overflow-hidden shadow-[0_2px_12px_rgba(0,0,0,0.08)] flex flex-col">
      <div className={`${aspectClass} bg-gray-100 relative overflow-hidden`}>
        {product.image_url ? (
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100">
            <svg
              className="w-12 h-12 text-gray-300"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 10.5V6a3.75 3.75 0 1 0-7.5 0v4.5m11.356-1.993 1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 0 1-1.12-1.243l1.264-12A1.125 1.125 0 0 1 5.513 7.5h12.974c.576 0 1.059.435 1.119 1.007ZM8.625 10.5a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm5.625 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
              />
            </svg>
          </div>
        )}
        {outOfStock && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <span className="text-white text-xs font-bold px-2.5 py-1 bg-red-500 rounded-full">
              Agotado
            </span>
          </div>
        )}
        {product.compare_price && !outOfStock && (
          <div className="absolute top-2 left-2 bg-red-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
            −{Math.round((1 - product.price / product.compare_price) * 100)}%
          </div>
        )}
      </div>
      <div className="p-2.5 flex flex-col flex-1">
        <p className="text-xs font-semibold text-gray-900 leading-snug line-clamp-2 mb-auto">
          {product.name}
        </p>
        <div className="flex items-center justify-between mt-2 gap-1">
          <span
            className="text-sm font-black"
            style={{ color: "var(--color-primary, #111827)" }}
          >
            {displayPrice}
          </span>
          {!outOfStock &&
            !readOnly &&
            (qty > 0 ? (
              <div
                className="flex items-center rounded-full overflow-hidden"
                style={{ backgroundColor: "var(--color-primary, #111827)" }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  onClick={() => updateQty(product._id, qty - 1)}
                  className="w-7 h-7 flex items-center justify-center text-sm font-bold active:opacity-60 transition-opacity"
                  style={{ color: "var(--color-primary-fg, #fff)" }}
                  aria-label={`Quitar ${product.name}`}
                >
                  −
                </button>
                <span
                  className="min-w-[1.1rem] text-center text-xs font-bold tabular-nums"
                  style={{ color: "var(--color-primary-fg, #fff)" }}
                >
                  {qty}
                </span>
                <button
                  onClick={() => onCardClick(product)}
                  className="w-7 h-7 flex items-center justify-center text-sm font-bold active:opacity-60 transition-opacity"
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
                  onCardClick(product);
                }}
                className="w-8 h-8 rounded-full text-white text-xl font-bold flex items-center justify-center border-none cursor-pointer active:scale-90 transition-transform"
                style={{ background: "var(--color-primary, #111827)" }}
                aria-label={`Agregar ${product.name}`}
              >
                +
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
