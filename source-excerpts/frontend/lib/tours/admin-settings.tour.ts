import type { DriveStep } from "driver.js";

/**
 * Tour de la página Configuración.
 *
 * La página tiene 8 pestañas y un solo tour lineal no podría highlightear
 * elementos de pestañas inactivas (no están en el DOM). Solución: dividimos
 * el tour por pestaña y mostramos el sub-tour de la pestaña activa cuando
 * el usuario toca "Tour de ayuda".
 *
 * Convención de tono unificada (2026-05-25):
 *  - voseo rioplatense ("configurá", "tocá", "te permite")
 *  - títulos de 2-4 palabras
 *  - descripción: oración descriptiva + valor práctico opcional
 *  - sin emojis, sin "el sistema", sin "puedes/haz clic"
 */

const negocioSteps: DriveStep[] = [
  {
    element: '[data-tour="settings-business-info"]',
    popover: {
      title: "Datos del negocio",
      description:
        "Acá editás el nombre y el logo que ve tu cliente en el menú y en los comprobantes. El logo se sube a la nube y se sirve optimizado.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="settings-order-modes"]',
    popover: {
      title: "Modos de pedido",
      description:
        "Activá los flujos que querés ofrecer: en mesa (QR), para llevar o delivery. Tu cliente solo ve los modos que tenés prendidos.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="settings-schedule"]',
    popover: {
      title: "Horario de atención",
      description:
        'Definí horas de apertura y cierre. Fuera de horario, el menú muestra "Cerrado" y no acepta pedidos nuevos. Podés forzar abierto/cerrado para casos especiales.',
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="settings-table-qr"]',
    popover: {
      title: "QR de mesas",
      description:
        "Generá un PDF con los QR de cada mesa, listos para imprimir y pegar. El cliente escanea y entra directo al menú con la mesa precargada.",
      side: "top",
      align: "start",
    },
  },
];

const equipoSteps: DriveStep[] = [
  {
    element: '[data-tour="settings-team"]',
    popover: {
      title: "Equipo de operación",
      description:
        "Creá cuentas para tu personal (cocina, recepción, técnicos). Solo pueden ver y cambiar estados de órdenes — no acceden al panel admin ni a configuración.",
      side: "top",
      align: "start",
    },
  },
];

const pagosSteps: DriveStep[] = [
  {
    element: '[data-tour="settings-bank-accounts"]',
    popover: {
      title: "Cuentas PagoMóvil",
      description:
        "Cargá las cuentas a las que tu cliente puede transferirte. Podés tener varias activas y marcar una como predeterminada. El QR S7B oficial se sube acá también.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="settings-payment-methods"]',
    popover: {
      title: "Métodos habilitados",
      description:
        "Activá los métodos que aceptás (efectivo, PagoMóvil, transferencia, tarjeta). Los métodos desactivados no aparecen al cliente al momento de pagar.",
      side: "top",
      align: "start",
    },
  },
];

const modulosSteps: DriveStep[] = [
  {
    element: '[data-tour="settings-modules"]',
    popover: {
      title: "Módulos del negocio",
      description:
        'Activá o desactivá funcionalidades según tu tipo de negocio. Los marcados como "Recomendado" vienen prendidos por defecto para tu arquetipo. Lo que no aplica a tu rubro queda oculto, pero podés mostrarlo si lo necesitás.',
      side: "bottom",
      align: "start",
    },
  },
];

const cuentaSteps: DriveStep[] = [
  {
    element: '[data-tour="settings-account"]',
    popover: {
      title: "Mi cuenta",
      description:
        "Tus datos como admin del tenant: correo y rol. Para cambiar el correo o crear más admins contactá a soporte.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="settings-password"]',
    popover: {
      title: "Cambiar contraseña",
      description:
        'Necesitás la contraseña actual. La nueva tiene que tener al menos 8 caracteres. Si la olvidaste, usá "Olvidé mi contraseña" desde el login.',
      side: "top",
      align: "start",
    },
  },
];

/**
 * Map de steps por pestaña activa. AdminSettingsPage usa
 * `adminSettingsStepsByTab[activeTab]` como input a useTour.
 * Pestañas activas: negocio | equipo | pagos | cuenta
 * (apariencia tiene su propio tour en admin-appearance.tour.ts)
 */
const reservasSteps: DriveStep[] = [];

export const adminSettingsStepsByTab = {
  negocio: negocioSteps,
  equipo: equipoSteps,
  pagos: pagosSteps,
  modulos: modulosSteps,
  reservas: reservasSteps,
  cuenta: cuentaSteps,
} as const;

/**
 * Steps default (compatibilidad con código legacy que importaba
 * `adminSettingsSteps` directamente). Apunta al sub-tour de Negocio.
 */
export const adminSettingsSteps: DriveStep[] = negocioSteps;
