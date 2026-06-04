import { useState, useRef, useCallback } from "react";
import {
  NavLink,
  Outlet,
  useNavigate,
  useParams,
  useLocation,
} from "react-router-dom";
import {
  LayoutDashboard,
  BarChart2,
  Settings,
  Palette,
  LogOut,
  ChefHat,
  Menu,
  X,
  HelpCircle,
  Package,
  Link2,
  ClipboardList,
  Calendar,
  Users,
  FileText,
  Wallet,
  Coins,
  Receipt,
  CreditCard,
  QrCode,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  SocketEvent,
  roomName,
  ARCHETYPE_MODULE_DEFAULTS,
} from "@foodorder/types";
import type {
  Tenant,
  TenantModules,
  BusinessType,
  NewOrderPayload,
  NewCashOrderPayload,
} from "@foodorder/types";
import { useAuthStore } from "../../stores/auth.store";
import { disconnectSocket } from "../../lib/socket";
import { useTourStore } from "../../stores/tour.store";
import { tenantsApi, authApi } from "../../lib/api";
import { useSocketRoom, useSocketEvent } from "../../hooks/useSocketRoom";
import { playNewOrderBeep } from "../../lib/sounds";

type NavItem = {
  label: string;
  path: string;
  icon: React.ElementType;
  end?: boolean;
  /** null = siempre visible (core). string = solo visible si tenant.modules[key] es true */
  module: keyof TenantModules | null;
};

const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    path: "",
    icon: LayoutDashboard,
    end: true,
    module: null,
  },
  { label: "Órdenes", path: "ordenes", icon: ClipboardList, module: null },
  { label: "Productos", path: "productos", icon: Package, module: null },
  { label: "Analytics", path: "analytics", icon: BarChart2, module: null },
  {
    label: "Vista Cocina",
    path: "cocina",
    icon: ChefHat,
    module: "kitchen_kds",
  },
  {
    label: "Inventario",
    path: "inventario",
    icon: Package,
    module: "inventory_tracking",
  },
  { label: "Agenda", path: "agenda", icon: Calendar, module: "booking" },
  { label: "Staff", path: "staff", icon: Users, module: "staff_management" },
  {
    label: "Cotizaciones",
    path: "cotizaciones",
    icon: FileText,
    module: "quotes_estimates",
  },
  {
    label: "Presupuestos",
    path: "presupuestos",
    icon: Receipt,
    module: "quotation_builder",
  },
  {
    label: "Links de Pago",
    path: "links-pago",
    icon: Link2,
    module: "payment_links",
  },
  {
    label: "Finanzas",
    path: "finanzas",
    icon: Wallet,
    module: "finance_documents",
  },
  { label: "Páginas QR", path: "qr-pages", icon: QrCode, module: "qr_pages" },
  { label: "Caja", path: "caja", icon: CreditCard, module: null },
  { label: "Monedas", path: "monedas", icon: Coins, module: null },
  { label: "Apariencia", path: "apariencia", icon: Palette, module: null },
  {
    label: "Configuración",
    path: "configuracion",
    icon: Settings,
    module: null,
  },
];

/** Mapeo ruta → tourId para el botón "Tour de ayuda" del sidebar */
const ROUTE_TOUR_MAP: Record<string, string> = {
  "": "admin-dashboard",
  ordenes: "admin-orders",
  productos: "admin-products",
  analytics: "admin-analytics",
  cocina: "admin-kitchen-view",
  inventario: "admin-inventory",
  agenda: "admin-agenda",
  staff: "admin-staff",
  cotizaciones: "admin-quotes",
  presupuestos: "admin-quotations",
  "links-pago": "admin-payment-links",
  "qr-pages": "admin-qr-pages",
  finanzas: "admin-finance",
  caja: "admin-caja",
  monedas: "admin-rates",
  apariencia: "admin-appearance",
  configuracion: "admin-settings",
};

export function AdminLayout() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { clearAuth, user } = useAuthStore();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { reset } = useTourStore();
  const qc = useQueryClient();
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: tenant } = useQuery<Tenant>({
    queryKey: ["tenant-me"],
    queryFn: tenantsApi.getMe,
    enabled: !!user?.tenantId,
    staleTime: 5 * 60 * 1000,
  });

  // ── WebSocket — suscripción persistente al room admin ──────────────────
  // Esto se mantiene activo en todas las páginas del admin (el layout nunca
  // desmonta mientras el usuario está en /:slug/admin/*). De esta forma el
  // admin recibe notificaciones y las queries se invalidan aunque esté en
  // Configuración, Productos o cualquier otra página.
  useSocketRoom(user?.tenantId ? roomName.admin(user.tenantId) : null);

  const refreshOrderQueries = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      qc.invalidateQueries({ queryKey: ["pending-verification"] });
      qc.invalidateQueries({ queryKey: ["pending-cash"] });
      qc.invalidateQueries({ queryKey: ["admin-kitchen-orders"] });
    }, 300);
  }, [qc]);

  const handleNewOrder = useCallback(
    (data: NewOrderPayload) => {
      refreshOrderQueries();
      playNewOrderBeep();
      const o = data?.order;
      const label =
        o?.orderType === "takeaway"
          ? `Para llevar${o.pickup_code ? ` · ${o.pickup_code}` : ""}`
          : o?.orderType === "delivery"
            ? "Delivery"
            : `Mesa ${o?.tableNumber ?? "?"}`;
      toast.info(`Nuevo pedido — ${label}`);
    },
    [refreshOrderQueries],
  );

  const handleNewCashOrder = useCallback(
    (data: NewCashOrderPayload) => {
      refreshOrderQueries();
      playNewOrderBeep();
      const o = data?.order;
      const label =
        o?.orderType === "takeaway"
          ? `Para llevar${o.pickup_code ? ` · ${o.pickup_code}` : ""}`
          : `Mesa ${o?.tableNumber ?? "?"}`;
      toast.warning(`Cobro pendiente en caja — ${label}`);
    },
    [refreshOrderQueries],
  );

  const handlePaymentPending = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["pending-verification"] });
    toast.warning("Nuevo PagoMóvil por verificar");
  }, [qc]);

  useSocketEvent(SocketEvent.NEW_ORDER, handleNewOrder);
  useSocketEvent(SocketEvent.NEW_CASH_ORDER, handleNewCashOrder);
  useSocketEvent(SocketEvent.PAYMENT_PENDING, handlePaymentPending);
  useSocketEvent(SocketEvent.ORDER_STATUS_CHANGED, refreshOrderQueries);

  const tenantName = tenant?.name ?? tenantSlug;

  const visibleNavItems = NAV_ITEMS.filter(({ module }) => {
    if (!module) return true;
    if (!tenant) return false; // mientras carga, ocultar gated items (evita flash)

    const arch = tenant.business_types?.[0] as BusinessType | undefined;
    if (arch) {
      const archDefaults = ARCHETYPE_MODULE_DEFAULTS[arch];
      // Si el módulo NO pertenece al arquetipo, nunca mostrarlo en el sidebar.
      // Esto previene que cambios de plan (PLAN_MODULE_MAP) activen módulos de
      // arquetipos incorrectos (ej: booking: true para tenants food).
      if (!(module in archDefaults)) return false;
      // Módulo aplicable → valor guardado > default del arquetipo
      const stored = tenant.modules?.[module as keyof TenantModules];
      if (stored !== undefined) return stored;
      return archDefaults[module as keyof TenantModules] ?? false;
    }
    // Sin arquetipo definido → tenant legacy / en proceso de config → usar stored o mostrar
    const stored = tenant.modules?.[module as keyof TenantModules];
    return stored ?? true;
  });

  /** Detecta la sección activa y resetea su tour para que arranque de nuevo */
  const handleHelpTour = () => {
    const base = `/${tenantSlug}/admin`;
    const section = location.pathname.replace(base, "").replace(/^\//, "");
    const tourId = ROUTE_TOUR_MAP[section] ?? "admin-dashboard";
    reset(tourId);
    // El useTour de la página activa detectará el reset y re-lanzará en el siguiente render.
    // Como estamos en el mismo layout usamos un evento custom para notificar a la página.
    window.dispatchEvent(
      new CustomEvent("tour:restart", { detail: { tourId } }),
    );
  };

  const logout = () => {
    // Best-effort: notificamos al backend para revocar la sesión server-side
    // (cierra la familia + blacklistea el access). Si falla por red caída,
    // igual limpiamos local y navegamos — el access expira solo en {JWT_EXPIRES_IN}.
    const { refreshToken } = useAuthStore.getState();
    if (refreshToken) {
      void authApi.logout(refreshToken).catch(() => {
        /* ignore — server-side revoke best-effort */
      });
    }
    disconnectSocket();
    clearAuth();
    // Siempre al login universal — sin rastro del slug en la URL.
    navigate("/admin/login", { replace: true });
  };

  const base = `/${tenantSlug}/admin`;

  return (
    <div className="theme-admin min-h-dvh bg-bg flex">
      {/* ── Sidebar desktop (md: íconos, lg: completo) ────────────────── */}
      <aside
        data-tour="admin-sidebar"
        className="hidden md:flex md:w-16 lg:w-60 flex-shrink-0 flex-col transition-all"
        style={{
          background: "linear-gradient(180deg, #3D1572 0%, #1E0A3C 100%)",
        }}
      >
        {/* Brand */}
        <div
          className="flex items-center justify-center lg:justify-start lg:px-4 gap-3 flex-shrink-0 py-4"
          style={{
            background:
              "linear-gradient(135deg, #7C3AED 0%, #C026D3 55%, #EA580C 100%)",
          }}
        >
          <div className="bg-white rounded-xl p-1.5 flex-shrink-0 shadow-md">
            <img src="/logo-bia.png" alt="Bia" className="h-10 w-auto block" />
          </div>
          <span className="hidden lg:block leading-tight truncate min-w-0">
            <span className="font-bold text-white text-sm block truncate">
              {tenantName}
            </span>
            <span className="text-white/60 font-normal text-xs">
              Panel admin
            </span>
          </span>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 space-y-0.5 px-2">
          {visibleNavItems.map(({ label, path, icon: Icon, end }) => (
            <NavLink
              key={label}
              to={path ? `${base}/${path}` : base}
              end={end}
              title={label}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-white/20 text-white"
                    : "text-white/55 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              <Icon size={18} className="flex-shrink-0" />
              <span className="hidden lg:block">{label}</span>
            </NavLink>
          ))}
        </nav>

        {/* User + logout + tour */}
        <div className="flex-shrink-0 px-2 lg:px-4 py-4 border-t border-white/10 space-y-1">
          <p className="hidden lg:block text-xs text-white/40 truncate mb-2">
            {user?.email}
          </p>
          <button
            onClick={handleHelpTour}
            title="Tour de ayuda"
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors px-1 py-1 w-full"
          >
            <HelpCircle size={16} className="flex-shrink-0" />
            <span className="hidden lg:block">Tour de ayuda</span>
          </button>
          <button
            onClick={logout}
            title="Cerrar sesión"
            className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors px-1 py-1 w-full"
          >
            <LogOut size={16} className="flex-shrink-0" />
            <span className="hidden lg:block">Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* ── Mobile overlay nav ─────────────────────────────── */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setMobileOpen(false)}
        >
          <aside
            className="w-72 h-full flex flex-col"
            style={{
              background: "linear-gradient(180deg, #3D1572 0%, #1E0A3C 100%)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="flex items-center justify-between px-5 py-4 flex-shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, #7C3AED 0%, #C026D3 55%, #EA580C 100%)",
              }}
            >
              <div className="flex items-center gap-2.5">
                <div className="bg-white rounded-xl p-1.5 flex-shrink-0 shadow-md">
                  <img
                    src="/logo-bia.png"
                    alt="Bia"
                    className="h-9 w-auto block"
                  />
                </div>
                <span className="font-bold text-white text-sm">
                  {tenantName}
                </span>
              </div>
              <button
                onClick={() => setMobileOpen(false)}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-white/70 hover:text-white hover:bg-white/20"
              >
                <X size={20} />
              </button>
            </div>
            <nav className="flex-1 py-3 space-y-0.5 px-3">
              {visibleNavItems.map(({ label, path, icon: Icon, end }) => (
                <NavLink
                  key={label}
                  to={path ? `${base}/${path}` : base}
                  end={end}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-4 py-3.5 rounded-xl text-base font-medium transition-colors ${
                      isActive
                        ? "bg-white/20 text-white"
                        : "text-white/55 hover:bg-white/10 hover:text-white"
                    }`
                  }
                >
                  <Icon size={20} />
                  {label}
                </NavLink>
              ))}
            </nav>
            <div className="px-5 py-5 border-t border-white/10 space-y-3">
              <p className="text-xs text-white/40 truncate">{user?.email}</p>
              <button
                onClick={() => {
                  setMobileOpen(false);
                  handleHelpTour();
                }}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <HelpCircle size={16} />
                Tour de ayuda
              </button>
              <button
                onClick={logout}
                className="flex items-center gap-2 text-sm text-white/50 hover:text-white transition-colors"
              >
                <LogOut size={16} />
                Cerrar sesión
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* ── Main area ──────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile topbar */}
        <header
          className="md:hidden h-14 flex items-center justify-between px-4 sticky top-0 z-30"
          style={{
            background:
              "linear-gradient(135deg, #7C3AED 0%, #C026D3 55%, #EA580C 100%)",
          }}
        >
          <button
            onClick={() => setMobileOpen(true)}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-white/70 hover:text-white hover:bg-white/20"
          >
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <div className="bg-white rounded-lg p-1 flex-shrink-0">
              <img
                src="/logo-bia.png"
                alt="Bia"
                className="h-7 max-w-[28px] w-auto block"
              />
            </div>
            <span className="font-bold text-white text-sm truncate">
              {tenantName}
            </span>
          </div>
          <button
            onClick={logout}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-white/70 hover:text-white hover:bg-white/20"
          >
            <LogOut size={18} />
          </button>
        </header>

        <main className="flex-1 p-4 md:p-6 overflow-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
