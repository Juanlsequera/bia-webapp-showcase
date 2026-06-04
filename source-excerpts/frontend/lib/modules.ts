import { useContext } from "react";
import { TenantContext } from "./tenant";
import { TenantModules } from "@foodorder/types";

/**
 * Devuelve true si el módulo está activo en el tenant actual.
 * Ejemplo: const hasKitchen = useModule('kitchen_kds');
 */
export function useModule(name: keyof TenantModules): boolean {
  const tenant = useContext(TenantContext);
  return !!tenant?.modules?.[name];
}

/**
 * Devuelve el objeto completo de módulos activos.
 */
export function useModules(): Partial<TenantModules> {
  const tenant = useContext(TenantContext);
  return tenant?.modules ?? {};
}

/**
 * Devuelve true si al menos uno de los módulos dados está activo.
 * Ejemplo: useAnyModule(['booking', 'staff_management'])
 */
export function useAnyModule(names: Array<keyof TenantModules>): boolean {
  const tenant = useContext(TenantContext);
  return names.some((n) => !!tenant?.modules?.[n]);
}
