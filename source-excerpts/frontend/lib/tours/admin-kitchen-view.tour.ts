import type { DriveStep } from "driver.js";

export const adminKitchenViewSteps: DriveStep[] = [
  {
    element: '[data-tour="kitchen-header"]',
    popover: {
      title: "Vista de operación",
      description:
        'Seguimiento en tiempo real de las órdenes activas. Solo vos como admin podés marcar "Completado" — tu personal de operación no entra acá.',
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="kitchen-columns"]',
    popover: {
      title: "Columnas de estado",
      description:
        'Tres columnas en orden de flujo: "Nuevos" (pagados, listos para procesar), "En proceso" (en elaboración) y "Listos" (completados, esperando entrega o retiro).',
      side: "top",
      align: "center",
    },
  },
  {
    element: '[data-tour="kitchen-deliver-button"]',
    popover: {
      title: "Marcar completado",
      description:
        'Solo aparece en la columna "Listos". Tocá cuando se concretó la entrega, el retiro o el servicio. Se actualiza al instante en todas las pantallas conectadas.',
      side: "left",
      align: "center",
    },
  },
];
