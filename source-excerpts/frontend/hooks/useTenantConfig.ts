import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { tenantConfigApi, type TenantConfig } from "../lib/api/tenant-config";
import { extractErrorMessage } from "../lib/extract-error-message";

const QUERY_KEY = ["tenant-config", "me"] as const;

/**
 * Hook de acceso a la config dinámica del tenant (admin).
 *
 * - Fetch: GET /tenants/me/config (stale 5 min).
 * - Update: PATCH /tenants/me/config con deep merge del backend.
 *   En optimistic update se aplica el patch localmente mientras el
 *   server confirma, con rollback automático en caso de error.
 */
export function useTenantConfig() {
  const qc = useQueryClient();

  const query = useQuery<TenantConfig>({
    queryKey: QUERY_KEY,
    queryFn: tenantConfigApi.getMine,
    staleTime: 5 * 60 * 1000, // 5 min
  });

  const mutation = useMutation<TenantConfig, Error, TenantConfig>({
    mutationFn: (patch) => tenantConfigApi.update(patch),
    onMutate: async (patch) => {
      // Cancelar fetches en vuelo para evitar sobreescritura
      await qc.cancelQueries({ queryKey: QUERY_KEY });
      const prev = qc.getQueryData<TenantConfig>(QUERY_KEY);
      // Optimistic update — merge superficial para la UI
      qc.setQueryData<TenantConfig>(QUERY_KEY, (old) => ({
        ...(old ?? {}),
        ...patch,
      }));
      return prev;
    },
    onError: (err, _patch, prev) => {
      // Rollback
      qc.setQueryData(QUERY_KEY, prev);
      toast.error(
        extractErrorMessage(err, "Error al guardar la configuración"),
      );
    },
    onSuccess: (newConfig) => {
      // Reemplazar con la respuesta real del servidor (merge completo)
      qc.setQueryData(QUERY_KEY, newConfig);
      toast.success("Configuración guardada");
    },
  });

  return {
    config: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    update: mutation.mutate,
    isPending: mutation.isPending,
  };
}
