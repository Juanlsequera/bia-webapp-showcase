import { Navigate, Outlet, useParams } from "react-router-dom";
import { useAuthStore } from "../../stores/auth.store";
import { UserRole } from "@foodorder/types";

interface Props {
  allowedRoles: UserRole[];
}

/**
 * Guard de autenticación para rutas admin y kitchen.
 *
 * Reglas:
 * - Sin sesión → login.
 * - Rol no permitido → login.
 * - Tenant mismatch (storedSlug ≠ URL slug) → login.
 * - storedSlug nulo pero user tiene tenantId (sesión migrada sin slug) →
 *   limpiar store + login. Sin esto, un admin con JWT válido de "negocio-b"
 *   podría ver el panel con el tema/UI de "negocio-a".
 *
 * Para admin: redirige a /admin/login (canonical, sin slug).
 * Para kitchen: redirige a /:slug/cocina/login (kitchen siempre es por slug/QR).
 */
export function ProtectedRoute({ allowedRoles }: Props) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();
  const {
    accessToken,
    user,
    tenantSlug: storedSlug,
    clearAuth,
  } = useAuthStore();

  const isKitchenRoute = allowedRoles.includes("kitchen");
  const loginPath = isKitchenRoute
    ? `/${tenantSlug}/cocina/login`
    : "/admin/login";

  // Sin sesión → login
  if (!accessToken || !user) {
    return <Navigate to={loginPath} replace />;
  }

  // Rol no permitido → login
  if (!allowedRoles.includes(user.role)) {
    return <Navigate to={loginPath} replace />;
  }

  // Solo aplica a rutas admin (no kitchen, no superadmin que no tiene tenantId)
  if (!isKitchenRoute && user.role !== "superadmin") {
    // storedSlug nulo + user tiene tenantId → sesión migrada sin slug: limpiar y re-login
    if (!storedSlug && user.tenantId) {
      clearAuth();
      return <Navigate to={loginPath} replace />;
    }

    // Tenant mismatch: el JWT pertenece a otro negocio
    if (storedSlug && tenantSlug && storedSlug !== tenantSlug) {
      return <Navigate to={loginPath} replace />;
    }
  }

  return <Outlet />;
}
