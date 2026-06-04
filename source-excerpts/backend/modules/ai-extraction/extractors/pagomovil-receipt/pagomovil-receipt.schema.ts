import { z } from "zod";

export const pagomovilReceiptSchema = z.object({
  isValidReceipt: z
    .boolean()
    .describe("true si la imagen es un comprobante de PagoMóvil venezolano"),
  reference: z
    .string()
    .nullable()
    .describe("Número de referencia, solo dígitos (8-15 chars)"),
  amount: z
    .number()
    .nullable()
    .describe("Monto en Bs. como número JS (ej: 1000.50)"),
  date: z.string().nullable().describe("Fecha en formato dd/mm/yyyy"),
  beneficiaryPhone: z
    .string()
    .nullable()
    .describe("Teléfono destinatario, 11 dígitos empezando en 04"),
  beneficiaryCedula: z
    .string()
    .nullable()
    .describe("Cédula/RIF destinatario formato V-12345678 o J-123456789"),
  beneficiaryName: z
    .string()
    .nullable()
    .describe("Nombre del titular destinatario"),
  beneficiaryBank: z
    .string()
    .nullable()
    .describe("Banco destino, valor crudo (BANESCO, BANCO DE VENEZUELA, etc.)"),
  issuerBank: z
    .string()
    .nullable()
    .describe("Banco emisor inferido del logo o estilo del recibo"),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe("Confianza del modelo en la extracción"),
});

export type PagomovilReceipt = z.infer<typeof pagomovilReceiptSchema>;

/** JSON Schema para el structured output del LLM (Gemini + Claude) */
export const pagomovilReceiptJsonSchema = {
  type: "object",
  properties: {
    isValidReceipt: {
      type: "boolean",
      description:
        "true si la imagen es un comprobante de PagoMóvil venezolano",
    },
    reference: {
      type: "string",
      nullable: true,
      description: "Número de referencia, solo dígitos (8-15 chars)",
    },
    amount: {
      type: "number",
      nullable: true,
      description: "Monto en Bs. como número JS (ej: 1000.50)",
    },
    date: {
      type: "string",
      nullable: true,
      description: "Fecha en formato dd/mm/yyyy",
    },
    beneficiaryPhone: {
      type: "string",
      nullable: true,
      description: "Teléfono destinatario, 11 dígitos empezando en 04",
    },
    beneficiaryCedula: {
      type: "string",
      nullable: true,
      description: "Cédula/RIF destinatario formato V-12345678 o J-123456789",
    },
    beneficiaryName: {
      type: "string",
      nullable: true,
      description: "Nombre del titular destinatario",
    },
    beneficiaryBank: {
      type: "string",
      nullable: true,
      description: "Banco destino, valor crudo",
    },
    issuerBank: {
      type: "string",
      nullable: true,
      description: "Banco emisor inferido del logo o estilo",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
      description: "Confianza del modelo en la extracción",
    },
  },
  required: ["isValidReceipt", "confidence"],
};
