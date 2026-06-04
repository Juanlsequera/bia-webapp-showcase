import type { DriveStep } from "driver.js";

export const kitchenKdsSteps: DriveStep[] = [
  {
    element: '[data-tour="kitchen-columns"]',
    popover: {
      title: "Panel de operación",
      description:
        'Cuatro columnas en orden de flujo: "Pendiente caja" (efectivo o débito sin confirmar), "Nuevos" (pagados), "En proceso" y "Listos para entregar o retirar".',
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="kitchen-card-action"]',
    popover: {
      title: "Avanzar la orden",
      description:
        'Tocá el botón de la orden para moverla a la siguiente etapa. Cuando pasa a "Lista", tu cliente recibe una notificación automática en su celular.',
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="kitchen-elapsed"]',
    popover: {
      title: "Indicador de urgencia",
      description:
        "Verde = menos de 5 min, amarillo = menos de 12 min, rojo = 12 min o más. Así detectás de un vistazo qué órdenes necesitan atención urgente.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="kitchen-tv-link"]',
    popover: {
      title: "Vista TV",
      description:
        "Si tenés una pantalla grande en el local, entrá a /cocina/tv para verla a pantalla completa en 3 columnas. Se refresca cada 8 segundos sin tener que recargar.",
      side: "bottom",
      align: "start",
    },
  },
];
