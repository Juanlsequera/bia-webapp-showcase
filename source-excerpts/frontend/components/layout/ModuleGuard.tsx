import { Navigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { tenantConfigApi } from "../../lib/api/tenant-config";

interface Props {
  /** Clave del módulo en TenantConfig.modules (e.g. "kitchen_kds") */
  module: string;
  children: React.ReactNode;
  /**
   * Ruta de redirección si el módulo está deshabilitado.
   * Puede ser relativa al tenant (e.g. "admin", "cocina/login") o absoluta ("/foo").
   * Si se omite, redirige a /:slug/no-disponible?reason=<module>.
   */
  redirectTo?: string;
}

/**
 * ModuleGuard — renderiza `children` solo si el módulo está habilitado.
 *
 * Lee la config pública del tenant (sin auth, cacheada 5min).
 * Si el módulo está explícitamente en `false`, redirige.
 * Si la config no cargó aún, no bloquea (evita flash de redirect).
 * Si el módulo no existe en la config (tenant legacy), lo considera habilitado.
 */
export function ModuleGuard({ module, children, redirectTo }: Props) {
  const { tenantSlug } = useParams<{ tenantSlug: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["public-config", tenantSlug],
    queryFn: () => tenantConfigApi.getPublic(tenantSlug!),
    enabled: !!tenantSlug,
    staleTime: 5 * 60 * 1000,
  });

  // Mientras carga, no redireccionamos para evitar flash — la página se renderiza
  // y si luego resulta deshabilitada, se redirige en el siguiente tick.
  if (isLoading) return null;

  const modules = (data as Record<string, unknown> | undefined)?.modules as
    | Record<string, boolean>
    | undefined;

  // Un módulo ausente en la config se trata como habilitado (backward-compat con tenants legacy).
  const isEnabled = modules ? modules[module] !== false : true;

  if (!isEnabled) {
    const fallback = redirectTo
      ? redirectTo.startsWith("/")
        ? redirectTo
        : `/${tenantSlug}/${redirectTo}`
      : `/${tenantSlug}/no-disponible?reason=${module}`;
    return <Navigate to={fallback} replace />;
  }

  return <>{children}</>;
}
