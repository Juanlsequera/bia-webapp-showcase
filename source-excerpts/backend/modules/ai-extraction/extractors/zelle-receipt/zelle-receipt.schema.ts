import { z } from "zod";

export const zelleReceiptSchema = z.object({
  isValidDocument: z
    .boolean()
    .describe("true si la imagen es un comprobante de pago Zelle"),
  amount: z
    .number()
    .nullable()
    .describe(
      "Monto en USD como número JS. Zelle opera exclusivamente en dólares. Formato americano: coma=miles, punto=decimal.",
    ),
  currency: z
    .literal("USD")
    .nullable()
    .describe(
      "Siempre USD — Zelle opera exclusivamente en dólares americanos.",
    ),
  date: z.string().nullable().describe("Fecha en formato YYYY-MM-DD"),
  time: z
    .string()
    .nullable()
    .describe(
      "Hora en formato HH:MM (24h). Si viene en AM/PM, convertir. La hora puede ser US (ET/CT/PT).",
    ),
  reference: z
    .string()
    .nullable()
    .describe(
      'ID de confirmación de Zelle. Suele ser alfanumérico, ej: "Z12345678" o un código único de la transacción.',
    ),
  senderEmail: z
    .string()
    .nullable()
    .describe(
      "Email o teléfono del emisor del pago Zelle. Frecuente en comprobantes directos de Zelle.",
    ),
  recipientEmail: z
    .string()
    .nullable()
    .describe("Email o teléfono registrado en Zelle del destinatario."),
  senderName: z
    .string()
    .nullable()
    .describe("Nombre del emisor. null si no aparece."),
  recipientName: z
    .string()
    .nullable()
    .describe("Nombre del destinatario del pago Zelle."),
  memo: z
    .string()
    .nullable()
    .describe("Memo o nota de la transacción Zelle. null si no aparece."),
  bankApp: z
    .string()
    .nullable()
    .describe(
      'App bancaria o plataforma usada para enviar el Zelle. Ej: "Wells Fargo", "Bank of America", "Chase", "Citi", "Zelle app". null si no se puede determinar.',
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "high: monto+referencia+destinatario claros; medium: alguno ambiguo; low: imagen borrosa o datos incompletos",
    ),
  notes: z
    .string()
    .nullable()
    .describe("Observaciones adicionales del modelo (opcional)"),
});

export type ZelleReceiptExtracted = z.infer<typeof zelleReceiptSchema>;

export const zelleReceiptJsonSchema = {
  type: "object",
  properties: {
    isValidDocument: {
      type: "boolean",
      description: "true si es un comprobante de pago Zelle",
    },
    amount: { type: "number", nullable: true, description: "Monto en USD" },
    currency: {
      type: "string",
      nullable: true,
      description: "Siempre USD para Zelle",
    },
    date: { type: "string", nullable: true, description: "Fecha YYYY-MM-DD" },
    time: { type: "string", nullable: true, description: "Hora HH:MM (24h)" },
    reference: {
      type: "string",
      nullable: true,
      description: "ID de confirmación Zelle",
    },
    senderEmail: {
      type: "string",
      nullable: true,
      description: "Email o teléfono del emisor",
    },
    recipientEmail: {
      type: "string",
      nullable: true,
      description: "Email o teléfono del destinatario",
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
    memo: {
      type: "string",
      nullable: true,
      description: "Memo o nota de la transacción",
    },
    bankApp: {
      type: "string",
      nullable: true,
      description: "App bancaria usada para el Zelle",
    },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    notes: { type: "string", nullable: true },
  },
  required: ["isValidDocument", "confidence"],
};
