import type {
  DocumentExtractor,
  ExtractionContext,
} from "../../core/document-extractor.interface";
import {
  pagomovilReceiptSchema,
  pagomovilReceiptJsonSchema,
} from "./pagomovil-receipt.schema";
import { buildPagomovilPrompt } from "./pagomovil-receipt.prompt";
import type { PagomovilReceipt } from "./pagomovil-receipt.schema";

/**
 * Extractor de comprobantes PagoMóvil venezolanos.
 *
 * Reemplaza el OCR client-side (Tesseract.js) con un LLM con visión.
 * No requiere auth — el cliente final lo usa durante el checkout.
 *
 * Para agregar soporte a un banco nuevo: solo actualizar el prompt.
 * No se toca este archivo.
 */
export class PagomovilReceiptExtractor implements DocumentExtractor<PagomovilReceipt> {
  readonly type = "pagomovil-receipt";
  readonly schema = pagomovilReceiptSchema;
  readonly requiresAuth = false;
  readonly maxImageBytes = 5 * 1024 * 1024; // 5MB

  buildJsonSchema(): Record<string, unknown> {
    return pagomovilReceiptJsonSchema;
  }

  buildPrompt(ctx?: ExtractionContext): string {
    return buildPagomovilPrompt(ctx);
  }

  postProcess(raw: PagomovilReceipt): PagomovilReceipt {
    if (raw.beneficiaryPhone) {
      raw.beneficiaryPhone = raw.beneficiaryPhone.replace(/\D/g, "");
      // Normalizar 10 dígitos que empiezan en 4 → 04...
      if (
        raw.beneficiaryPhone.length === 10 &&
        raw.beneficiaryPhone.startsWith("4")
      ) {
        raw.beneficiaryPhone = `0${raw.beneficiaryPhone}`;
      }
    }
    if (raw.beneficiaryCedula) {
      // Normalizar V12345678 → V-12345678
      raw.beneficiaryCedula = raw.beneficiaryCedula
        .toUpperCase()
        .replace(/^([VEJPG])[\s.-]?(\d+)$/, "$1-$2");
    }
    return raw;
  }
}
