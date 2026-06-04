import type { DriveStep } from "driver.js";

export const adminInventorySteps: DriveStep[] = [
  {
    element: '[data-tour="inventory-header"]',
    popover: {
      title: "Control de inventario",
      description:
        "Acá ves y editás el stock de tus productos. BIA descuenta automáticamente cada vez que se crea un pedido.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="inventory-alerts"]',
    popover: {
      title: "Alertas de stock bajo",
      description:
        "Los productos con stock bajo (5 o menos unidades) aparecen destacados en rojo para que reabastezcas a tiempo.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="inventory-table"]',
    popover: {
      title: "Productos con stock",
      description:
        "Acá aparecen solo los productos con control de stock habilitado. Tocá la cantidad para editarla — se guarda al instante.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="inventory-quantity"]',
    popover: {
      title: "Editar cantidad",
      description:
        "Ingresá la cantidad disponible. Tiene que ser un número positivo. Se guarda apenas movés el foco fuera del campo.",
      side: "left",
      align: "center",
    },
  },
];
