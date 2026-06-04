import type { DriveStep } from "driver.js";

export const adminDashboardSteps: DriveStep[] = [
  {
    element: '[data-tour="admin-sidebar"]',
    popover: {
      title: "Navegación del panel",
      description:
        "Desde acá accedés a todas las secciones: Dashboard, Órdenes, Analytics, Configuración. En móvil se abre con el ícono de menú.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="dashboard-metrics"]',
    popover: {
      title: "Métricas del día",
      description:
        "Pedidos totales, ingresos y ticket promedio actualizados al instante. Solo cuenta lo del día actual.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="dashboard-quick-links"]',
    popover: {
      title: "Accesos rápidos",
      description:
        "Atajos a las secciones que más vas a usar. También podés llegar a las mismas pantallas desde la barra lateral.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="dashboard-pending-payments"]',
    popover: {
      title: "Verificaciones PagoMóvil",
      description:
        "Cuando tu cliente sube su comprobante, aparece acá en tiempo real. Comparalo con tu SMS bancario y aprobá o rechazá indicando el motivo.",
      side: "top",
      align: "start",
    },
  },
];
