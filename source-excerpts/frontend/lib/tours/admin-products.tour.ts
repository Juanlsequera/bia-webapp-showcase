import type { DriveStep } from "driver.js";

export const adminProductsSteps: DriveStep[] = [
  {
    element: '[data-tour="products-add-btn"]',
    popover: {
      title: "Agregar producto",
      description:
        "Abrí el formulario para crear un producto nuevo. Los precios van en USD — BIA convierte automáticamente a Bs. con la tasa BCV del día.",
      side: "left",
      align: "start",
    },
  },
  {
    element: '[data-tour="products-list"]',
    popover: {
      title: "Lista de productos",
      description:
        "Los productos aparecen agrupados por categoría. Los desactivados quedan guardados pero no se muestran en el menú del cliente.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="products-toggle"]',
    popover: {
      title: "Activar / desactivar",
      description:
        "Activá o desactivá un producto sin borrarlo. Útil cuando se agota un ítem temporalmente y querés ocultarlo del menú.",
      side: "left",
      align: "center",
    },
  },
  {
    element: '[data-tour="products-stock"]',
    popover: {
      title: "Control de stock",
      description:
        'Si cargás un stock máximo, BIA descuenta automáticamente con cada pedido y muestra "Agotado" cuando llega a 0. Dejalo vacío para stock ilimitado.',
      side: "left",
      align: "center",
    },
  },
  {
    element: '[data-tour="products-image"]',
    popover: {
      title: "Imagen del producto",
      description:
        "Subí una foto directamente o pegá una URL. Las imágenes se guardan en la nube y aparecen optimizadas en el menú del cliente.",
      side: "bottom",
      align: "start",
    },
  },
];
