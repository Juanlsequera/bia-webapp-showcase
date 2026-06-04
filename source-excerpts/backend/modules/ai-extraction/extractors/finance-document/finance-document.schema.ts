import { z } from "zod";

export const financeDocumentSchema = z.object({
  isValidDocument: z
    .boolean()
    .describe(
      "true si la imagen es un documento financiero (factura, recibo, comprobante de pago, nota de entrega, etc.)",
    ),
  documentType: z
    .enum(["invoice", "receipt", "delivery_note", "other"])
    .nullable()
    .describe(
      "invoice=factura, receipt=recibo/comprobante de pago, delivery_note=nota de entrega, other=otro",
    ),
  type: z
    .enum(["ingreso", "egreso"])
    .nullable()
    .describe(
      "ingreso si el negocio recibió dinero (cliente pagó), egreso si el negocio gastó dinero (pago a proveedor)",
    ),
  date: z
    .string()
    .nullable()
    .describe(
      "Fecha en formato YYYY-MM-DD. Si solo hay mes y año, usar el día 1.",
    ),
  supplier: z
    .string()
    .nullable()
    .describe(
      "Nombre del proveedor (si es egreso) o del cliente/pagador (si es ingreso). Empresa o persona.",
    ),
  description: z
    .string()
    .nullable()
    .describe(
      "Descripción breve del concepto, servicio o motivo del documento",
    ),
  amount: z
    .number()
    .nullable()
    .describe(
      "Monto total del documento como número (sin símbolos ni puntos de miles). Usar la moneda indicada en currency.",
    ),
  currency: z
    .enum(["USD", "VES"])
    .nullable()
    .describe(
      "USD = dólares americanos o equivalente (EUR, etc. convertir a USD), VES = bolívares venezolanos (Bs., Bs.D, Bsf.)",
    ),
  items: z
    .array(
      z.object({
        description: z.string().describe("Descripción del ítem o línea"),
        quantity: z
          .number()
          .nullable()
          .optional()
          .describe("Cantidad (si aplica)"),
        unitPrice: z.number().nullable().optional().describe("Precio unitario"),
        total: z.number().nullable().optional().describe("Total de la línea"),
      }),
    )
    .default([])
    .describe(
      "Ítems individuales si el documento los lista. Vacío si no hay detalle de líneas.",
    ),
  subtotal: z
    .number()
    .nullable()
    .optional()
    .describe(
      "Base imponible antes de impuestos. Solo si el documento muestra subtotal e impuesto por separado. null si no hay desglose.",
    ),
  taxAmount: z
    .number()
    .nullable()
    .optional()
    .describe(
      "Monto del impuesto (IVA, IGTF, etc.) como número. Solo si está explícito. null si no hay desglose.",
    ),
  confidence: z
    .enum(["high", "medium", "low"])
    .describe(
      "high: monto + fecha + proveedor claros; medium: alguno ambiguo; low: imagen borrosa o datos incompletos",
    ),
  notes: z
    .string()
    .nullable()
    .describe("Observaciones del modelo sobre la extracción (opcionales)"),
});

export type FinanceDocumentExtracted = z.infer<typeof financeDocumentSchema>;

/** JSON Schema para el structured output del LLM (Gemini + Claude) */
export const financeDocumentJsonSchema = {
  type: "object",
  properties: {
    isValidDocument: {
      type: "boolean",
      description: "true si la imagen es un documento financiero",
    },
    documentType: {
      type: "string",
      enum: ["invoice", "receipt", "delivery_note", "other"],
      nullable: true,
    },
    type: {
      type: "string",
      enum: ["ingreso", "egreso"],
      nullable: true,
      description:
        "ingreso=negocio recibió dinero, egreso=negocio pagó a proveedor",
    },
    date: {
      type: "string",
      nullable: true,
      description: "Fecha en formato YYYY-MM-DD",
    },
    supplier: {
      type: "string",
      nullable: true,
      description: "Nombre del proveedor o cliente",
    },
    description: {
      type: "string",
      nullable: true,
      description: "Concepto o descripción del documento",
    },
    amount: {
      type: "number",
      nullable: true,
      description: "Monto total como número",
    },
    currency: {
      type: "string",
      enum: ["USD", "VES"],
      nullable: true,
    },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          description: { type: "string" },
          quantity: { type: "number", nullable: true },
          unitPrice: { type: "number", nullable: true },
          total: { type: "number", nullable: true },
        },
        required: ["description"],
      },
    },
    subtotal: {
      type: "number",
      nullable: true,
      description:
        "Base imponible antes de impuestos. null si no hay desglose fiscal explícito.",
    },
    taxAmount: {
      type: "number",
      nullable: true,
      description:
        "Monto del impuesto (IVA, IGTF). null si no hay desglose fiscal explícito.",
    },
    confidence: {
      type: "string",
      enum: ["high", "medium", "low"],
    },
    notes: {
      type: "string",
      nullable: true,
    },
  },
  required: ["isValidDocument", "confidence", "items"],
};
