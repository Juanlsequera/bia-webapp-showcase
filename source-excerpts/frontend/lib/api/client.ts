import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from "axios";
import type { RefreshTokenResponse } from "@foodorder/types";
import { useAuthStore } from "../../stores/auth.store";

/**
 * Instancia axios única para toda la app web. Inyecta JWT + traceId en cada
 * request y captura el `x-trace-id` que devuelve el backend. Los módulos de
 * cada dominio (orders.ts, products.ts, etc.) la consumen via `import { api }`.
 */
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/api",
  headers: { "Content-Type": "application/json" },
});

// ── TraceId ──────────────────────────────────────────────────────────────
// Cada response trae `x-trace-id`. Lo capturamos y lo mandamos en los
// siguientes requests para que back+front compartan ID en el mismo flujo.
let lastTraceId: string | null = null;

/** Expuesto por si un componente quiere pintarlo en el UI para soporte. */
export function getLastTraceId(): string | null {
  return lastTraceId;
}

// ── Request interceptor: JWT + trace id ──────────────────────────────────
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  if (lastTraceId) config.headers["x-trace-id"] = lastTraceId;
  return config;
});

// ── Refresh on 401: coalescing + retry once ──────────────────────────────
// Si una respuesta vuelve 401 y tenemos refresh_token, intentamos rotar el
// par una sola vez antes de tirar el error. Si N requests fallan en simultáneo
// (caso típico al cargar una página tras que el access expiró), todas comparten
// la MISMA promise de refresh para no spamear al backend ni rotar varias veces.
let refreshInFlight: Promise<string | null> | null = null;

async function performRefresh(): Promise<string | null> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return null;

  try {
    // Usamos axios crudo (no `api`) para evitar disparar nuestro propio
    // interceptor en loop si el refresh también devuelve 401.
    const res = await axios.post<RefreshTokenResponse>(
      `${api.defaults.baseURL}/auth/refresh`,
      { refresh_token: refreshToken },
      { headers: { "Content-Type": "application/json" } },
    );
    useAuthStore
      .getState()
      .setTokens(res.data.access_token, res.data.refresh_token);
    return res.data.access_token;
  } catch {
    return null;
  }
}

function getOrStartRefresh(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

// ── Response interceptor: captura trace + refresh on 401 ─────────────────
api.interceptors.response.use(
  (res) => {
    const trace = res.headers?.["x-trace-id"];
    if (typeof trace === "string" && trace) {
      lastTraceId = trace;
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.debug(
          `[trace:${trace}] ${res.config.method?.toUpperCase()} ${res.config.url} ${res.status}`,
        );
      }
    }
    return res;
  },
  async (error: AxiosError) => {
    const trace = error.response?.headers?.["x-trace-id"];
    if (typeof trace === "string" && trace) {
      lastTraceId = trace;
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.warn(
          `[trace:${trace}] ${error.config?.method?.toUpperCase()} ${error.config?.url} ${error.response?.status} FAILED`,
        );
      }
    }

    // ── Safety net global: loguear 5xx ──────────────────────────────────────
    // Log all server errors (5xx) to console para trazabilidad.
    const status5xx = error.response?.status;
    const data5xx = error.response?.data as Record<string, unknown> | undefined;
    if (status5xx && status5xx >= 500) {
      // eslint-disable-next-line no-console
      console.error("[server-error]", {
        method: error.config?.method?.toUpperCase(),
        url: error.config?.url,
        statusCode: status5xx,
        message: data5xx?.message as string | undefined,
        debug: import.meta.env.DEV ? data5xx?.debug : undefined,
        traceId: (data5xx?.traceId ?? trace) as string | undefined,
      });
    }

    const original = error.config as
      | (AxiosRequestConfig & { _retried?: boolean })
      | undefined;
    const status = error.response?.status;
    const url = original?.url ?? "";

    // 401 → intentar refresh una sola vez por request. Evitamos:
    // - reintentar el propio /auth/refresh o /auth/logout (loop infinito)
    // - reintentar si ya marcamos _retried
    // - reintentar si no tenemos refresh_token (no hay nada que rotar)
    const isAuthEndpoint =
      url.includes("/auth/refresh") ||
      url.includes("/auth/logout") ||
      url.includes("/auth/login");
    const hasRefresh = !!useAuthStore.getState().refreshToken;

    if (
      status === 401 &&
      original &&
      !original._retried &&
      !isAuthEndpoint &&
      hasRefresh
    ) {
      original._retried = true;
      const newAccess = await getOrStartRefresh();
      if (newAccess) {
        // Inyectar el access nuevo y reintentar el request original.
        original.headers = {
          ...(original.headers ?? {}),
          Authorization: `Bearer ${newAccess}`,
        };
        return api.request(original) as Promise<AxiosResponse>;
      }
      // Refresh falló → caer al clearAuth de abajo.
    }

    if (status === 401) {
      useAuthStore.getState().clearAuth();

      // Si estamos en una ruta admin o kitchen protegida, redirigir al login
      // para que la pantalla no quede rota con queries fallidas sin token.
      // Usamos window.location porque estamos fuera del contexto React/Router.
      const path = window.location.pathname;
      const isProtectedPage =
        (path.includes("/admin") && !path.includes("/admin/login")) ||
        (path.includes("/cocina") && !path.includes("/cocina/login"));
      if (isProtectedPage && !url.includes("/auth/")) {
        window.location.replace("/admin/login");
      }
    }

    return Promise.reject(error);
  },
);

/** Helper para descargar un CSV con el JWT actual. */
export async function downloadCsv(
  path: string,
  filename: string,
): Promise<void> {
  const token = useAuthStore.getState().accessToken;
  const baseUrl = import.meta.env.VITE_API_URL ?? "/api";
  const res = await fetch(`${baseUrl}${path}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
}
