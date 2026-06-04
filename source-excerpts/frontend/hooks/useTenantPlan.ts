import { useQuery } from "@tanstack/react-query";
import { tenantsApi } from "../lib/api";

export function useTenantPlan() {
  const { data: tenant } = useQuery({
    queryKey: ["tenant-me"],
    queryFn: tenantsApi.getMe,
    staleTime: 5 * 60 * 1000,
  });

  const plan = tenant?.plan ?? "starter";
  return {
    plan,
    modules: (tenant?.modules ?? {}) as Record<string, boolean | undefined>,
    isPro: plan === "pro" || plan === "enterprise",
    isEnterprise: plan === "enterprise",
    hasModule: (key: string): boolean => {
      const m = (tenant?.modules ?? {}) as Record<string, boolean | undefined>;
      return m[key] !== false;
    },
  };
}
