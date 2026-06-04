import { Outlet, useNavigate, useParams } from "react-router-dom";
import { LogOut, ChefHat, Wifi, WifiOff, HelpCircle } from "lucide-react";
import { useAuthStore } from "../../stores/auth.store";
import { disconnectSocket } from "../../lib/socket";
import { useSocketConnected } from "../../hooks/useSocketRoom";
import { useTourStore } from "../../stores/tour.store";
import { authApi } from "../../lib/api";

export function KitchenLayout() {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const { clearAuth, tenantSlug: storedSlug } = useAuthStore();
  const navigate = useNavigate();

  const connected = useSocketConnected();
  const { reset } = useTourStore();

  const handleHelpTour = () => {
    reset("kitchen-kds");
    window.dispatchEvent(
      new CustomEvent("tour:restart", { detail: { tourId: "kitchen-kds" } }),
    );
  };

  const logout = () => {
    // Best-effort: notificamos al backend para revocar la sesión server-side.
    const { refreshToken } = useAuthStore.getState();
    if (refreshToken) {
      void authApi.logout(refreshToken).catch(() => {
        /* ignore — server-side revoke best-effort */
      });
    }
    disconnectSocket();
    clearAuth();
    // Para cocina el login es siempre por slug (acceso vía QR/URL específica).
    // Usamos storedSlug del store; si por alguna razón está vacío, fallback al slug de la URL.
    navigate(`/${storedSlug ?? tenantSlug}/cocina/login`, { replace: true });
  };

  return (
    <div className="h-dvh overflow-hidden bg-gray-950 text-white flex flex-col">
      {/* Header fijo */}
      <header className="flex-shrink-0 bg-gray-900 border-b border-gray-800 px-4 h-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ChefHat size={18} className="text-orange-400" />
          <span className="font-bold text-white text-sm">{tenantSlug}</span>
          <span className="text-gray-600 text-xs hidden sm:inline">
            · Cocina
          </span>
        </div>

        <div className="flex items-center gap-3">
          {/* Indicador WS */}
          <span
            className={`flex items-center gap-1 text-xs ${connected ? "text-green-500" : "text-gray-600"}`}
            title={
              connected ? "Tiempo real activo" : "Sin conexión en tiempo real"
            }
          >
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
          </span>

          <button
            onClick={handleHelpTour}
            title="Tour de ayuda"
            className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-400 transition-colors"
          >
            <HelpCircle size={14} />
          </button>

          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          >
            <LogOut size={14} />
            Salir
          </button>
        </div>
      </header>

      {/* Contenido — ocupa el resto de la pantalla */}
      <div className="flex-1 overflow-hidden">
        <Outlet />
      </div>
    </div>
  );
}
