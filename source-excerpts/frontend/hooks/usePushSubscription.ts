import { useState, useEffect } from "react";
import { toast } from "sonner";
import { pushApi } from "../lib/api";

// La clave pública VAPID se expone al frontend (es pública por diseño).
// La privada NUNCA sale del backend.
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY as
  | string
  | undefined;

/**
 * Convierte la clave VAPID base64url a Uint8Array para la Push API.
 * El formato que exige pushManager.subscribe() no es el mismo que el de btoa().
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  // Crear sobre un ArrayBuffer explícito para satisfacer el tipo de la Push API
  const buffer = new ArrayBuffer(raw.length);
  const arr = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

interface UsePushSubscriptionReturn {
  /** Estado actual del permiso de notificaciones */
  permission: NotificationPermission | "unsupported";
  /** Si el device ya está suscripto a esta orden */
  subscribed: boolean;
  /** Solicita permiso y suscribe al servidor */
  requestAndSubscribe: () => Promise<void>;
  /** Si está procesando la suscripción */
  isLoading: boolean;
  /** Cierra la suscripción del browser (útil en logout o cleanup de OrderStatusPage) */
  unsubscribe: () => Promise<void>;
}

/**
 * PMV.1.15 · Hook de Web Push para OrderStatusPage.
 *
 * Flujo:
 * 1. Lee el permiso actual del browser.
 * 2. Al llamar requestAndSubscribe(): pide permiso → registra SW →
 *    suscribe pushManager → POST al backend para guardar la sub.
 *
 * No pedir permiso automáticamente al montar — UX: solo al click explícito.
 */
export function usePushSubscription(
  orderId: string | undefined,
  tenantSlug: string | undefined,
): UsePushSubscriptionReturn {
  const [permission, setPermission] = useState<
    NotificationPermission | "unsupported"
  >("default");
  const [subscribed, setSubscribed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Leer permiso actual al montar
  useEffect(() => {
    if (!("Notification" in window)) {
      setPermission("unsupported");
      return;
    }
    setPermission(Notification.permission);
  }, []);

  const requestAndSubscribe = async (): Promise<void> => {
    if (!orderId || !tenantSlug) return;

    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      toast.error("Tu navegador no soporta notificaciones push");
      return;
    }

    if (!VAPID_PUBLIC_KEY) {
      // En dev sin configurar la var, falla silenciosamente
      console.warn("[Push] VITE_VAPID_PUBLIC_KEY no configurado");
      return;
    }

    setIsLoading(true);
    try {
      // 1. Pedir permiso al usuario
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== "granted") {
        toast.error("Permiso de notificaciones denegado");
        return;
      }

      // 2. Registrar el Service Worker
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
      });
      await navigator.serviceWorker.ready;

      // 3. Suscribir al push manager del browser
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, // requerido por Chrome — no permite silent push
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      // 4. Mandar la suscripción al backend
      const subJson = sub.toJSON();
      await pushApi.subscribe(tenantSlug, orderId, {
        endpoint: sub.endpoint,
        keys: {
          p256dh: subJson.keys?.p256dh ?? "",
          auth: subJson.keys?.auth ?? "",
        },
      });

      setSubscribed(true);
      toast.success(
        "¡Notificaciones activadas! Te avisamos cuando tu pedido esté listo.",
      );
    } catch (err) {
      console.error("[Push] Error al suscribir:", err);
      toast.error("No se pudieron activar las notificaciones");
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Cancela la suscripción a nivel browser. No borra la sub del backend
   * (eso lo maneja el job cuando recibe 410 del provider) pero evita que
   * el siguiente usuario del mismo browser reciba notificaciones de la
   * orden anterior.
   */
  const unsubscribe = async (): Promise<void> => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration("/");
      if (!reg) return;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
        setSubscribed(false);
      }
    } catch (err) {
      // Best-effort — no rompemos UX por esto.
      console.warn("[Push] unsubscribe falló:", err);
    }
  };

  // Cleanup automático: si cambia el orderId (otro pedido en mismo browser)
  // o el componente se desmonta, cancelamos la sub vieja para no leakear
  // notificaciones a otros usuarios del mismo dispositivo.
  useEffect(() => {
    return () => {
      void unsubscribe();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);

  return {
    permission,
    subscribed,
    requestAndSubscribe,
    isLoading,
    unsubscribe,
  };
}
