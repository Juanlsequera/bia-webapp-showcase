import type { DriveStep } from "driver.js";

export const adminPaymentLinksSteps: DriveStep[] = [
  {
    element: '[data-tour="payment-links-header"]',
    popover: {
      title: "Links de pago",
      description:
        "Creá links de cobro personalizados para compartir por WhatsApp, email o redes. Ideal para presupuestos, anticipos y cobros fuera del flujo de pedido.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="payment-links-create"]',
    popover: {
      title: "Crear nuevo link",
      description:
        "Generá un link único. Definí monto, descripción (opcional) y nombre del cliente (opcional). El link queda activo por 30 días.",
      side: "left",
      align: "start",
    },
  },
  {
    element: '[data-tour="payment-links-list"]',
    popover: {
      title: "Historial de links",
      description:
        "Lista de todos los links generados. Acá ves el estado (pendiente, pagado, cancelado), el monto, quién lo recibió y cuándo se creó.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="payment-links-copy"]',
    popover: {
      title: "Copiar link",
      description:
        "Copiá el link al portapapeles. Tu cliente lo abre, confirma el monto y elige su método de pago (tarjeta, transferencia, etc.).",
      side: "bottom",
      align: "center",
    },
  },
  {
    element: '[data-tour="payment-links-mark-paid"]',
    popover: {
      title: "Marcar como pagado",
      description:
        "Si tu cliente pagó por otro canal (efectivo, transferencia manual), marcalo como pagado manualmente para actualizar el registro.",
      side: "bottom",
      align: "center",
    },
  },
];
