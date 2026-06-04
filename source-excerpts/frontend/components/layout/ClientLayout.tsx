import { useParams, useNavigate, useLocation, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ShoppingBag, AlertTriangle, ArrowLeft } from "lucide-react";
import { type ReactNode } from "react";
import { tenantsApi } from "../../lib/api";
import { useCartStore } from "../../stores/cart.store";
import type { TenantPublic } from "@foodorder/types";
import { WhatsAppFAB } from "../WhatsAppFAB";
import { PoweredByBia } from "../ui/PoweredByBia";

interface ClientLayoutProps {
  children: ReactNode;
  /** Muestra botón ← en el header (CartPage, PagomovilPage, etc.) */
  backHref?: string;
  /** Título del header cuando no hay logo. Si es undefined, usa el nombre del tenant. */
  pageTitle?: string;
  /** Modo de moneda activo (lo controla MenuPage) */
  currencyMode?: "usd" | "bs";
  /** Callback para alternar moneda desde el header sticky */
  onToggleCurrency?: () => void;
}

export function ClientLayout({
  children,
  backHref,
  pageTitle,
  currencyMode,
  onToggleCurrency,
}: ClientLayoutProps) {
  const { tenantSlug, tableNumber } = useParams<{
    tenantSlug: string;
    tableNumber: string;
  }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { count, total } = useCartStore();

  const { data: tenant } = useQuery<TenantPublic>({
    queryKey: ["tenant", tenantSlug],
    queryFn: () => tenantsApi.getPublic(tenantSlug!),
    enabled: !!tenantSlug,
    // 5 min: el layout mounta en cada navegación entre páginas del cliente,
    // sería desperdicio refetchear cada vez. La tasa BCV (lo más volátil) se
    // cachea 1h en el backend de todas formas.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  const usdRate = tenant?.usdRate.value ?? null;
  const rateStale = tenant?.usdRate.stale ?? false;

  // El footer del carrito solo aparece en el menú, no en el carrito ni en orden
  const isMenuRoute = location.pathname.includes("/mesa/");
  const cartCount = count();
  const showCartFooter = isMenuRoute && cartCount > 0;

  return (
    <div className="min-h-screen bg-bg text-app-text">
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="bg-surface shadow-sm sticky top-0 z-20">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3 safe-top">
          {/* Botón atrás o logo del tenant */}
          {backHref ? (
            <button
              onClick={() => navigate(backHref)}
              className="w-11 h-11 -ml-2 rounded-xl flex items-center justify-center flex-shrink-0 text-muted hover:text-app-text hover:bg-bg transition-colors"
              aria-label="Volver"
            >
              <ArrowLeft size={22} />
            </button>
          ) : null}

          {/* Logo / nombre del tenant — siempre muestra nombre aunque haya logo */}
          <div className="flex-1 min-w-0 flex items-center gap-2">
            {tenant?.logo_url ? (
              <img
                src={tenant.logo_url}
                alt={tenant.name}
                className="h-8 w-8 rounded-lg object-cover flex-shrink-0"
              />
            ) : tenant?.name ? (
              <span
                className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-sm flex-shrink-0 select-none"
                style={{ background: "var(--color-primary)" }}
              >
                {tenant.name.charAt(0).toUpperCase()}
              </span>
            ) : null}
            <span className="font-bold text-base text-app-text truncate">
              {pageTitle ?? tenant?.name ?? ""}
            </span>
          </div>

          {/* Toggle USD/Bs en rutas de menú — tasa en las demás */}
          {usdRate !== null && isMenuRoute && onToggleCurrency ? (
            <button
              onClick={onToggleCurrency}
              title={`Tasa: $1 = Bs. ${usdRate.toLocaleString("es-VE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
              className="flex-shrink-0 flex items-center gap-0.5 text-xs font-bold px-2.5 py-1.5 rounded-full border transition-all active:scale-95"
              style={{
                borderColor: "var(--color-primary)",
                background: "transparent",
              }}
            >
              <span
                style={{
                  color:
                    currencyMode === "usd"
                      ? "var(--color-primary)"
                      : "var(--color-muted, #9CA3AF)",
                }}
              >
                USD
              </span>
              <span className="mx-0.5 text-muted/40">|</span>
              <span
                style={{
                  color:
                    currencyMode === "bs"
                      ? "var(--color-primary)"
                      : "var(--color-muted, #9CA3AF)",
                }}
              >
                Bs.
              </span>
            </button>
          ) : usdRate !== null ? (
            <div
              className={`flex items-center gap-1 text-xs ${rateStale ? "text-amber-500" : "text-muted"}`}
            >
              {rateStale && <AlertTriangle size={12} />}
              <span>
                $1 = Bs.{" "}
                {usdRate.toLocaleString("es-VE", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </span>
            </div>
          ) : null}

          {/* Botón carrito (solo en rutas de menú) */}
          {isMenuRoute && (
            <Link
              to={`/${tenantSlug}/carrito`}
              className="relative flex items-center gap-1.5 bg-primary text-white px-3 py-1.5 rounded-full text-sm font-semibold transition-opacity hover:opacity-90"
            >
              <ShoppingBag size={16} />
              {cartCount > 0 && (
                <span className="bg-white text-primary rounded-full min-w-[18px] h-[18px] flex items-center justify-center text-xs font-bold leading-none px-1">
                  {cartCount}
                </span>
              )}
            </Link>
          )}
        </div>

        {/* Sub-header mesa */}
        {tableNumber && (
          <div className="max-w-lg mx-auto px-4 pb-2">
            <span className="text-xs text-muted">Mesa {tableNumber}</span>
          </div>
        )}
      </header>

      {/* ── Contenido ────────────────────────────────────────────────────── */}
      {/* padding-bottom extra cuando hay footer flotante — incluye safe-area-inset */}
      <main className={showCartFooter ? "pb-28" : "pb-safe"}>
        {children}
        <PoweredByBia />
      </main>

      {/* ── Botón flotante de WhatsApp ───────────────────────────────────── */}
      <WhatsAppFAB contact={tenant?.contact} elevated={showCartFooter} />

      {/* ── Footer carrito flotante (solo menú con items) ─────────────────── */}
      {showCartFooter && (
        <div className="fixed bottom-0 left-0 right-0 z-20 px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] bg-gradient-to-t from-bg via-bg/95 to-transparent">
          <div className="max-w-lg mx-auto">
            <Link
              to={`/${tenantSlug}/carrito`}
              className="flex items-center justify-between w-full bg-primary text-white px-5 py-3.5 rounded-2xl shadow-lg hover:opacity-95 active:opacity-90 transition-opacity"
            >
              <span className="flex items-center gap-2 font-semibold">
                <span className="bg-white/20 rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">
                  {cartCount}
                </span>
                Ver pedido
              </span>
              <span className="font-bold text-sm">{total().toFixed(2)} $</span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
