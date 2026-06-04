import { io, Socket } from "socket.io-client";
import { useAuthStore } from "../stores/auth.store";

// Mantenemos UNA sola conexión por app (el browser no puede tener muchas
// conexiones WS abiertas contra el mismo origin sin costo). Si el JWT
// cambia (login/logout) forzamos reconexión con el token nuevo.
let socket: Socket | null = null;
let currentToken: string | null | undefined = undefined; // undefined = aún no inicializado

export function getSocket(): Socket {
  const token = useAuthStore.getState().accessToken;
  // En dev local VITE_API_URL puede no estar seteado — caemos a window.location.origin
  const baseURL = import.meta.env.VITE_API_URL ?? window.location.origin;

  // Si ya existe una conexión y el token no cambió → reusamos
  if (socket && currentToken === token) return socket;

  // Si hay un socket viejo con otro token → lo cerramos antes de abrir el nuevo
  if (socket) {
    socket.disconnect();
    socket = null;
  }

  currentToken = token;
  socket = io(baseURL, {
    // token va por auth (socket.io v4) — el backend lo lee en
    // `handshake.auth.token`. Si no hay token, el backend marca la
    // conexión como pública (solo rooms de mesa).
    auth: token ? { token } : {},
    // Si al browser se le escapa un message antes de que el socket
    // conecte, no queremos que se arme una tormenta de reconexiones.
    reconnectionAttempts: 10,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    // Forzamos websocket para evitar fallback a long-polling en dev
    // (si no, Render + Nginx pueden dar dolores de cabeza después).
    transports: ["websocket", "polling"],
  });

  if (import.meta.env.DEV) {
    socket.on("connect", () => console.debug("[ws] connected", socket?.id));
    socket.on("disconnect", (reason) =>
      console.debug("[ws] disconnected:", reason),
    );
    socket.on("connect_error", (err) =>
      console.debug("[ws] connect_error:", err.message),
    );
  }

  return socket;
}

// Útil cuando el usuario hace logout y queremos cerrar la conexión.
export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentToken = undefined;
  }
}
