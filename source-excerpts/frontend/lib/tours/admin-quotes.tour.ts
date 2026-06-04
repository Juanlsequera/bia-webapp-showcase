import type { DriveStep } from "driver.js";

export const adminQuotesSteps: DriveStep[] = [
  {
    element: '[data-tour="quotes-header"]',
    popover: {
      title: "Cotizaciones",
      description:
        "Acá llegan las solicitudes de servicio de tus clientes. Ves el estado de cada una y gestionás el proceso completo desde la solicitud hasta el trabajo terminado.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="quotes-filters"]',
    popover: {
      title: "Filtrar por estado",
      description:
        'Filtrá por estado para enfocarte en lo que necesita atención: las "Solicitudes" esperan tu cotización, las "Aprobadas" están listas para iniciar trabajo.',
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="quotes-list"]',
    popover: {
      title: "Lista de solicitudes",
      description:
        "Cada tarjeta muestra el servicio pedido, el cliente y el estado actual. El badge de color indica en qué parte del proceso está.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="quotes-quote-action"]',
    popover: {
      title: "Enviar cotización",
      description:
        "Ingresá el monto en USD y una nota opcional con detalles del trabajo. Tu cliente la recibe y puede aprobarla desde su celular.",
      side: "top",
      align: "start",
    },
  },
];
