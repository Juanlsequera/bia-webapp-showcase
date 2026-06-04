import { useEffect, useRef, useState } from "react";
import { JoinRoomAck } from "@bia/types";
import { getSocket } from "../lib/socket";

/**
 * Se une a un room de Socket.IO al montar y se desconecta al desmontar.
 *
 * El backend valida permisos contra el JWT en el handshake (ver
 * apps/api/src/modules/gateway/orders.gateway.ts). Si el ack vuelve con
 * ok=false lo logueamos — en UI no mostramos error porque los rooms no
 * son la UX principal, son solo para tiempo real.
 *
 * @param room nombre completo del room, ej "65a1...:kitchen" o "65a1...:table:5".
 *             Si es null/undefined/"" no intenta unirse (útil mientras cargamos
 *             el tenantId del backend).
 */
export function useSocketRoom(room: string | null | undefined): void {
  // Guardamos el último room al que nos unimos — si cambia (rare) salimos
  // del viejo antes de entrar al nuevo.
  const joinedRoomRef = useRef<string | null>(null);

  useEffect(() => {
    if (!room) return;
    const socket = getSocket();

    const join = () => {
      socket.emit("join", { room }, (ack: JoinRoomAck | undefined) => {
        if (ack && !ack.ok && import.meta.env.DEV) {
          console.warn("[ws] join rechazado:", ack.room, ack.error);
        }
      });
    };

    // Puede que el socket aún no esté conectado — join() corre al conectar
    // y también re-emite al reconectar (si el server reinicia, perdemos el
    // room y hay que volver a unirse).
    if (socket.connected) join();
    socket.on("connect", join);

    joinedRoomRef.current = room;

    return () => {
      socket.off("connect", join);
      // En Socket.IO no existe un "leave" universal — el servidor maneja
      // el leave automáticamente al disconnect. Si queremos salir del room
      // sin desconectar, podríamos agregar un handler 'leave' en el gateway.
      // Por ahora, como los rooms son estables por sesión, es suficiente
      // con limpiar la referencia.
      joinedRoomRef.current = null;
    };
  }, [room]);
}

/**
 * Retorna true mientras el socket esté conectado al servidor.
 * Se actualiza en tiempo real ante connect/disconnect.
 */
export function useSocketConnected(): boolean {
  const [connected, setConnected] = useState(() => getSocket().connected);
  useEffect(() => {
    const socket = getSocket();
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);
  return connected;
}

/**
 * Helper para suscribirse a un evento emitido por el servidor.
 * Devuelve el cleanup (para limpieza automática en useEffect).
 *
 * En dev, si el payload trae `traceId` lo logueamos para correlacionar el
 * evento con la cadena de logs del backend (mismo traceId que viaja en
 * `x-trace-id` para requests HTTP).
 *
 * @example
 *   useSocketEvent('new_order', (data) => { ... });
 */
export function useSocketEvent<T = unknown>(
  event: string,
  handler: (data: T) => void,
): void {
  // Usamos ref para que el effect no se re-dispare cuando el handler cambia.
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const socket = getSocket();
    const wrapped = (data: T) => {
      // Log de correlación en dev.
      if (import.meta.env.DEV) {
        const trace = (data as { traceId?: unknown } | null)?.traceId;
        const traceStr =
          typeof trace === "string" && trace ? `[trace:${trace}]` : "";
        // console.log para todos los eventos WS (visible sin activar "Verbose")
        // eslint-disable-next-line no-console
        console.log(`[ws]${traceStr} ← ${event}`);
      }
      handlerRef.current(data);
    };
    socket.on(event, wrapped);
    return () => {
      socket.off(event, wrapped);
    };
  }, [event]);
}
