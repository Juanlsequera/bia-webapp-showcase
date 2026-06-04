/**
 * Extrae un string legible del error de Axios.
 *
 * Distingue entre 3 categorías para dar feedback útil al usuario:
 *   - Network down (sin response) → "Sin conexión..." (revisar internet)
 *   - 5xx (error del servidor) → siempre genérico; detalle técnico va a console.error
 *   - 4xx (validación / negocio) → mensaje del backend
 *
 * El backend puede devolver varias estructuras en `response.data`:
 *   { message: "string" }
 *   { message: ["string1", "string2"] }          ← class-validator
 *   { message: { message: [...], error, statusCode } }  ← NestJS wrapping
 *
 * Siempre devuelve un string para que sea seguro pasarlo a toast.error() o JSX.
 */
export function extractErrorMessage(
  err: unknown,
  fallback = "Ocurrió un error. Intentá de nuevo.",
): string {
  const e = err as any;

  // Network error — axios no llega a recibir respuesta (DNS, timeout, offline).
  // `code` típico: 'ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'.
  if (e && !e.response && e.code) {
    if (e.code === "ECONNABORTED" || e.code === "ETIMEDOUT") {
      return "El servidor tardó demasiado en responder. Reintentá en unos segundos.";
    }
    return "Sin conexión con el servidor. Revisá tu internet y reintentá.";
  }

  const status = e?.response?.status;
  const data = e?.response?.data;

  // 5xx — nunca mostrar detalles técnicos al usuario. El backend manda un campo
  // "debug" (solo en dev) con el error real: lo logueamos en consola para el developer.
  if (status >= 500) {
    if (data?.debug) {
      console.error("[server-error]", data.debug, "| traceId:", data?.traceId);
    }
    return "Error del servidor. Intentá en unos minutos.";
  }

  // 4xx y similares — usar el mensaje del backend si vino, sino fallback.
  if (!data) return fallback;
  return readBackendMessage(data) ?? fallback;
}

/** Lee `data.message` (o `data.error`) tolerando los 3 shapes del backend. */
function readBackendMessage(data: any): string | null {
  if (!data) return null;
  const raw = data?.message;

  if (typeof raw === "string") return raw;

  if (Array.isArray(raw)) {
    const first = raw[0];
    if (typeof first === "string") return first;
  }

  if (typeof raw === "object" && raw !== null) {
    const inner = raw?.message;
    if (typeof inner === "string") return inner;
    if (Array.isArray(inner)) {
      const first = inner[0];
      if (typeof first === "string") return first;
    }
  }

  if (typeof data?.error === "string") return data.error;
  return null;
}

/**
 * Categoriza un error para que el caller pueda decidir UI más finamente.
 * Útil cuando querés diferenciar "reintentar" de "revisar input".
 */
export function categorizeError(
  err: unknown,
): "network" | "server" | "client" | "unknown" {
  const e = err as any;
  if (e && !e.response && e.code) return "network";
  const status = e?.response?.status;
  if (typeof status === "number") {
    if (status >= 500) return "server";
    if (status >= 400) return "client";
  }
  return "unknown";
}
