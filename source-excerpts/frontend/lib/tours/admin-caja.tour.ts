import type { DriveStep } from "driver.js";

export const adminCajaSteps: DriveStep[] = [
  {
    element: '[data-tour="caja-date-filter"]',
    popover: {
      title: "Período a revisar",
      description:
        'Elegí "Hoy", "Ayer", "Esta semana" o un rango personalizado. Todos los números y la tabla se filtran por este período.',
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="caja-summary-cards"]',
    popover: {
      title: "Resumen del período",
      description:
        "Total cobrado, transacciones aprobadas, pendientes y rechazadas. El total junta todos los métodos de pago convertidos a su moneda correspondiente.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="caja-by-method"]',
    popover: {
      title: "Desglose por método",
      description:
        "PagoMóvil y débito en Bs., efectivo en USD. Así podés cuadrar exactamente con lo que tenés en caja física al cierre del día.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="caja-arqueo"]',
    popover: {
      title: "Arqueo del día",
      description:
        "Registrá cuánto contaste físicamente: billetes en caja y el ticket del POS de débito. BIA calcula la diferencia y la resalta en rojo si no cuadra.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="caja-export"]',
    popover: {
      title: "Exportar a contabilidad",
      description:
        "Descargá las transacciones en CSV. Cada fila tiene un identificador único para reconciliar contra registros externos si surge alguna diferencia.",
      side: "bottom",
      align: "end",
    },
  },
];
