import type { DocumentExtractor } from "../../core/document-extractor.interface";
import {
  financeDocumentSchema,
  financeDocumentJsonSchema,
} from "./finance-document.schema";
import { buildFinanceDocumentPrompt } from "./finance-document.prompt";
import type { FinanceDocumentExtracted } from "./finance-document.schema";

/**
 * Extractor de documentos financieros: facturas, recibos, comprobantes de pago.
 *
 * Requiere auth — solo admins del tenant pueden usarlo.
 * Soporta PNG, JPG, WEBP y PDF-como-imagen (hasta 8MB por la complejidad de facturas).
 *
 * Para agregar soporte a un tipo de documento nuevo: actualizar el prompt.
 */
export class FinanceDocumentExtractor implements DocumentExtractor<FinanceDocumentExtracted> {
  readonly type = "finance-document";
  readonly schema = financeDocumentSchema;
  // Requiere JWT de admin. El endpoint de extracción verifica requiresAuth antes
  // de procesar la imagen. Tenants sin módulo finance_documents en el plan no
  // pueden llegar aquí desde el frontend (nav oculto + ProtectedRoute), y la
  // capa de almacenamiento (/admin/finance) tiene @RequireModule('finance_documents').
  readonly requiresAuth = true;
  readonly maxImageBytes = 8 * 1024 * 1024; // 8MB — facturas pueden ser más densas que PagoMóvil

  buildJsonSchema(): Record<string, unknown> {
    return financeDocumentJsonSchema;
  }

  buildPrompt(): string {
    return buildFinanceDocumentPrompt();
  }

  postProcess(raw: FinanceDocumentExtracted): FinanceDocumentExtracted {
    // Normalizar fecha a YYYY-MM-DD si viene en otro formato
    if (raw.date) {
      // dd/mm/yyyy → yyyy-mm-dd
      const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.date);
      if (ddmmyyyy) {
        raw.date = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
      }
      // dd-mm-yyyy → yyyy-mm-dd
      const ddmmyyyyDash = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw.date);
      if (ddmmyyyyDash) {
        raw.date = `${ddmmyyyyDash[3]}-${ddmmyyyyDash[2].padStart(2, "0")}-${ddmmyyyyDash[1].padStart(2, "0")}`;
      }
    }

    // Limpiar supplier (trim + colapsar espacios internos)
    if (raw.supplier) {
      raw.supplier = raw.supplier.replace(/\s+/g, " ").trim();
    }

    // Limpiar descripción
    if (raw.description) {
      raw.description = raw.description.replace(/\s+/g, " ").trim();
    }

    return raw;
  }
}
