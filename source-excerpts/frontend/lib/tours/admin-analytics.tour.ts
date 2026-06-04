import type { DriveStep } from "driver.js";

export const adminAnalyticsSteps: DriveStep[] = [
  {
    element: '[data-tour="analytics-date-range"]',
    popover: {
      title: "Rango de fechas",
      description:
        "Cambiá las fechas para ver semanas, meses o períodos personalizados. Todos los números de abajo se actualizan automáticamente.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="analytics-summary"]',
    popover: {
      title: "Resumen del período",
      description:
        "Pedidos totales, ingresos en USD, ticket promedio y producto más vendido para el rango seleccionado. Solo cuenta pedidos con pago aprobado.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="analytics-chart"]',
    popover: {
      title: "Ingresos por día",
      description:
        "El gráfico muestra cómo se distribuyeron las ventas en el tiempo. Te sirve para detectar los días de más movimiento y planificar al personal.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="analytics-top-products"]',
    popover: {
      title: "Productos más vendidos",
      description:
        "Ranking por ingresos generados. Usalo para decidir qué promover, qué subir de precio y qué retirar del menú.",
      side: "top",
      align: "start",
    },
  },
];
