import type { DriveStep } from "driver.js";

export const adminAgendaSteps: DriveStep[] = [
  {
    element: '[data-tour="agenda-header"]',
    popover: {
      title: "Agenda del día",
      description:
        "Acá ves todas las citas programadas organizadas por profesional. Cada cita muestra horario, estado y datos del cliente.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="agenda-date-picker"]',
    popover: {
      title: "Navegar por fechas",
      description:
        'Seleccioná cualquier fecha para ver su agenda. El botón "Hoy" te lleva de vuelta al día actual con un toque.',
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="agenda-bookings"]',
    popover: {
      title: "Citas por profesional",
      description:
        "Las citas se agrupan por profesional y se ordenan por hora. El badge de color indica el estado: azul = programada, amarillo = reprogramada, rojo = cancelada.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="agenda-actions"]',
    popover: {
      title: "Reprogramar o cancelar",
      description:
        "Con el botón ⋯ podés mover una cita a otro horario o cancelarla con un motivo opcional. Tu cliente recibe la actualización en tiempo real.",
      side: "left",
      align: "center",
    },
  },
];
