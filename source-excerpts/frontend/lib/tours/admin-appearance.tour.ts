import type { DriveStep } from "driver.js";

export const adminAppearanceSteps: DriveStep[] = [
  {
    element: '[data-tour="appearance-header"]',
    popover: {
      title: "Diseño del menú",
      description:
        "Acá configurás los colores, tipografía y bordes que ve tu cliente. Los cambios se aplican al instante sobre la vista previa.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="appearance-color"]',
    popover: {
      title: "Color principal",
      description:
        "Elegí un color base o pegá el código hexadecimal de tu marca. Aparece en botones, precios y elementos destacados del menú.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="appearance-fonts"]',
    popover: {
      title: "Tipografía",
      description:
        "Seleccioná fuentes distintas para títulos y para párrafos. Las opciones están optimizadas para móvil y mantienen buena legibilidad.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="appearance-radius"]',
    popover: {
      title: "Bordes",
      description:
        "Rectos (nítido), redondeados (clásico) o circulares (moderno). Afecta botones, tarjetas y campos de todo el menú.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="appearance-preview"]',
    popover: {
      title: "Vista previa en vivo",
      description:
        "Acá ves cómo queda el menú con los cambios. No tenés que guardar para previsualizar — se actualiza solo.",
      side: "top",
      align: "start",
    },
  },
];
