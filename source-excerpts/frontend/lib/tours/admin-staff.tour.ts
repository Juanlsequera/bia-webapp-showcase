import type { DriveStep } from "driver.js";

export const adminStaffSteps: DriveStep[] = [
  {
    element: '[data-tour="staff-header"]',
    popover: {
      title: "Profesionales",
      description:
        "Gestioná tu equipo de trabajo. Cada profesional tiene su propio horario y puede asignarse a servicios específicos. Tu cliente elige con quién atenderse.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="staff-create"]',
    popover: {
      title: "Agregar profesional",
      description:
        "Creá un nuevo miembro del equipo. Agregá nombre, bio corta y foto de perfil para que tus clientes los identifiquen fácil.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: '[data-tour="staff-table"]',
    popover: {
      title: "Lista de profesionales",
      description:
        "Cada fila muestra el profesional con su foto, la cantidad de servicios asignados y su estado activo/inactivo. Los inactivos no aparecen para reservas.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="staff-actions"]',
    popover: {
      title: "Editar y eliminar",
      description:
        'Editá los datos de un profesional o eliminalo del equipo. Para desactivar temporalmente sin perder los datos, editá y cambiá el estado a "Inactivo".',
      side: "left",
      align: "center",
    },
  },
];
