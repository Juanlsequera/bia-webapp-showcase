import type { DriveStep } from "driver.js";

export const adminOrdersSteps: DriveStep[] = [
  {
    element: '[data-tour="orders-filters"]',
    popover: {
      title: "Filtros",
      description:
        "Filtrá por rango de fechas, estado del pedido, método de pago o número de mesa. Podés combinar filtros para encontrar cualquier pedido específico.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="orders-export"]',
    popover: {
      title: "Descargar CSV",
      description:
        "Descargá el historial filtrado en CSV para abrirlo en Excel o Google Sheets. Útil para llevar contabilidad fuera del sistema.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: '[data-tour="orders-table"]',
    popover: {
      title: "Historial de órdenes",
      description:
        "Cada fila muestra el origen (mesa, takeaway, reserva o servicio), el total en USD, el estado y el método de pago. El total queda congelado al momento de crear la orden — no cambia aunque varíe la tasa BCV después.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="orders-status-badge"]',
    popover: {
      title: "Estados del pedido",
      description:
        "Amarillo = pendiente de cobro o verificación, azul = en proceso, verde = completado, rojo = cancelado.",
      side: "left",
      align: "center",
    },
  },
];
