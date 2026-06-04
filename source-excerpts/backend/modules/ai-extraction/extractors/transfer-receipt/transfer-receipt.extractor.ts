import type { DocumentExtractor } from "../../core/document-extractor.interface";
import {
  transferReceiptSchema,
  transferReceiptJsonSchema,
} from "./transfer-receipt.schema";
import { buildTransferReceiptPrompt } from "./transfer-receipt.prompt";
import type { TransferReceiptExtracted } from "./transfer-receipt.schema";

/**
 * Extractor de comprobantes de transferencia bancaria (venezolanos e internacionales).
 * Complementa PagoMóvil (pago móvil interbancario) y Zelle (transferencias US).
 *
 * No requiere auth — puede usarse en flujos de cliente para confirmar pagos por transferencia.
 */
export class TransferReceiptExtractor implements DocumentExtractor<TransferReceiptExtracted> {
  readonly type = "transfer-receipt";
  readonly schema = transferReceiptSchema;
  readonly requiresAuth = false;
  readonly maxImageBytes = 5 * 1024 * 1024; // 5MB

  buildJsonSchema(): Record<string, unknown> {
    return transferReceiptJsonSchema;
  }

  buildPrompt(): string {
    return buildTransferReceiptPrompt();
  }

  postProcess(raw: TransferReceiptExtracted): TransferReceiptExtracted {
    // Normalizar fecha dd/mm/yyyy → YYYY-MM-DD
    if (raw.date) {
      const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw.date);
      if (ddmmyyyy) {
        raw.date = `${ddmmyyyy[3]}-${ddmmyyyy[2].padStart(2, "0")}-${ddmmyyyy[1].padStart(2, "0")}`;
      }
      const ddmmyyyyDash = /^(\d{1,2})-(\d{1,2})-(\d{4})$/.exec(raw.date);
      if (ddmmyyyyDash) {
        raw.date = `${ddmmyyyyDash[3]}-${ddmmyyyyDash[2].padStart(2, "0")}-${ddmmyyyyDash[1].padStart(2, "0")}`;
      }
    }

    // Normalizar hora a HH:MM (quitar segundos si vienen)
    if (raw.time) {
      const hhmm = /^(\d{1,2}):(\d{2})/.exec(raw.time);
      if (hhmm) {
        raw.time = `${hhmm[1].padStart(2, "0")}:${hhmm[2]}`;
      }
    }

    // Trim de campos de texto
    if (raw.bank) raw.bank = raw.bank.replace(/\s+/g, " ").trim();
    if (raw.destinationBank)
      raw.destinationBank = raw.destinationBank.replace(/\s+/g, " ").trim();
    if (raw.senderName)
      raw.senderName = raw.senderName.replace(/\s+/g, " ").trim();
    if (raw.recipientName)
      raw.recipientName = raw.recipientName.replace(/\s+/g, " ").trim();
    if (raw.concept) raw.concept = raw.concept.replace(/\s+/g, " ").trim();

    return raw;
  }
}
