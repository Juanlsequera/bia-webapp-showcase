import type { DocumentExtractor } from "../../core/document-extractor.interface";
import {
  zelleReceiptSchema,
  zelleReceiptJsonSchema,
} from "./zelle-receipt.schema";
import { buildZelleReceiptPrompt } from "./zelle-receipt.prompt";
import type { ZelleReceiptExtracted } from "./zelle-receipt.schema";

/**
 * Extractor de comprobantes de pago Zelle (transferencias digitales en USD).
 * Muy usado en Venezuela para pagos en dólares entre particulares y negocios.
 *
 * No requiere auth — puede usarse en flujos de cliente para confirmar pagos en USD.
 */
export class ZelleReceiptExtractor implements DocumentExtractor<ZelleReceiptExtracted> {
  readonly type = "zelle-receipt";
  readonly schema = zelleReceiptSchema;
  readonly requiresAuth = false;
  readonly maxImageBytes = 5 * 1024 * 1024; // 5MB

  buildJsonSchema(): Record<string, unknown> {
    return zelleReceiptJsonSchema;
  }

  buildPrompt(): string {
    return buildZelleReceiptPrompt();
  }

  postProcess(raw: ZelleReceiptExtracted): ZelleReceiptExtracted {
    // Normalizar fecha MM/DD/YYYY (formato americano) → YYYY-MM-DD
    if (raw.date) {
      const mmddyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.date);
      if (mmddyyyy) {
        raw.date = `${mmddyyyy[3]}-${mmddyyyy[1].padStart(2, "0")}-${mmddyyyy[2].padStart(2, "0")}`;
      }
      // También manejar dd/mm/yyyy si viniera así
      const ddmmyyyy = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw.date);
      if (ddmmyyyy) {
        raw.date = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
      }
    }

    // Normalizar hora a HH:MM (quitar segundos si vienen, convertir AM/PM si es necesario)
    if (raw.time) {
      const hhmm = /^(\d{1,2}):(\d{2})/.exec(raw.time);
      if (hhmm) {
        raw.time = `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`;
      }
    }

    // Forzar currency a USD (Zelle siempre es USD)
    if (raw.isValidDocument && raw.amount != null) {
      raw.currency = "USD";
    }

    // Trim de campos de texto
    if (raw.senderName)
      raw.senderName = raw.senderName.replace(/\s+/g, " ").trim();
    if (raw.recipientName)
      raw.recipientName = raw.recipientName.replace(/\s+/g, " ").trim();
    if (raw.bankApp) raw.bankApp = raw.bankApp.replace(/\s+/g, " ").trim();
    if (raw.memo) raw.memo = raw.memo.replace(/\s+/g, " ").trim();

    return raw;
  }
}
