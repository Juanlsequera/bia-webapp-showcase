import { ExtractorRegistry } from "../core/extractor.registry";
import { PagomovilReceiptExtractor } from "./pagomovil-receipt/pagomovil-receipt.extractor";
import { FinanceDocumentExtractor } from "./finance-document/finance-document.extractor";
import { TransferReceiptExtractor } from "./transfer-receipt/transfer-receipt.extractor";
import { ZelleReceiptExtractor } from "./zelle-receipt/zelle-receipt.extractor";

/**
 * Registra todos los extractores disponibles.
 * Llamado al bootstrap del AiExtractionModule.
 *
 * Para agregar un extractor nuevo:
 * 1. Crear su carpeta en extractors/<tipo>/
 * 2. Importarlo acá y registrarlo con registry.register(new MiExtractor())
 */
export function registerAllExtractors(registry: ExtractorRegistry): void {
  registry.register(new PagomovilReceiptExtractor());
  registry.register(new FinanceDocumentExtractor());
  registry.register(new TransferReceiptExtractor());
  registry.register(new ZelleReceiptExtractor());
  // registry.register(new MenuPhotoExtractor());  // fase 3 - onboarding
}
