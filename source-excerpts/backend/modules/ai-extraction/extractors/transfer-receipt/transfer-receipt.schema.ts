import { z } from "zod";

export const transferReceiptSchema = z.object({
  isValidDocument: z
    .boolean()
    .describe("true si la imagen es un comprobante de transferencia bancaria"),
  bank: z
    .string()
    .nullable()
    .describe(
      'Banco emisor. Ej: "Banesco", "Mercantil", "BDV", "BNC", "Exterior", "BOD", "Bicentenario", "Banplus"',
    ),
  destinationBank: z
    .string()
    .nullable()
    .describe(
      "Banco receptor de la transferencia. null si no aparece en el comprobante.",
    ),
  amount: z
    .number()
    .nullable()
    .describe(
      "Monto transferido como número JS. VE: punto=miles, coma=decimal (1.000,50 → 1000.50). Internacional: coma=miles, punto=decimal.",
    ),
  currency: z
    .enum(["USD", "VES"])
    .nullable()
    .describe(
      "VES=bolívares (Bs., Bs.D, VES), USD=dólares ($, US$). En Venezuela predomina VES.",
    ),
  date: z
    .string()
    .nullable()
    .describe("Fecha de la transferencia en formato YYYY-MM-DD"),
  time: z
    .string()
    .nullable()
    .describe(
      "Hora de la transferencia en formato HH:MM (24h). null si no aparece.",
    ),
  reference: z
    .string()
    .nullable()
    .describe(
      "Número de referencia o confirmación bancaria. Suele ser 6-12 dígitos o alfanumérico.",
    ),
  senderName: z
    .string()
    .nullable()
    .describe(
      "Nombre, cédula o RIF del emisor (quien transfiere). null si no está en el comprobante.",
    ),
  recipientName: z
    .string()
    .nullable()
    .describe("Nombre o razón social del destinatario. null si no aparece."),
  recipientAccount: z
    .string()
    .nullable()
    .describe(
      "Últimos 4 dígitos o número parcial de cuenta destino. null si no aparece.",
    ),
  concept: z
    .string()
    .nullable()
    .describe(
      "Concepto o descripción de la transferencia. null si no aparece.",
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "high: monto+referencia+banco claros; medium: alguno ambiguo; low: imagen borrosa o datos incompletos",
    ),
  notes: z
    .string()
    .nullable()
    .describe("Observaciones adicionales del modelo (opcional)"),
});

export type TransferReceiptExtracted = z.infer<typeof transferReceiptSchema>;

export const transferReceiptJsonSchema = {
  type: "object",
  properties: {
    isValidDocument: {
      type: "boolean",
      description: "true si es un comprobante de transferencia bancaria",
    },
    bank: { type: "string", nullable: true, description: "Banco emisor" },
    destinationBank: {
      type: "string",
      nullable: true,
      description: "Banco receptor",
    },
    amount: {
      type: "number",
      nullable: true,
      description: "Monto transferido como número",
    },
    currency: { type: "string", enum: ["USD", "VES"], nullable: true },
    date: { type: "string", nullable: true, description: "Fecha YYYY-MM-DD" },
    time: { type: "string", nullable: true, description: "Hora HH:MM" },
    reference: {
      type: "string",
      nullable: true,
      description: "Número de referencia bancaria",
    },
    senderName: {
      type: "string",
      nullable: true,
      description: "Nombre del emisor",
    },
    recipientName: {
      type: "string",
      nullable: true,
      description: "Nombre del destinatario",
    },
    recipientAccount: {
      type: "string",
      nullable: true,
      description: "Últimos 4 dígitos de cuenta destino",
    },
    concept: {
      type: "string",
      nullable: true,
      description: "Concepto de la transferencia",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string", nullable: true },
  },
  required: ["isValidDocument", "confidence"],
};
