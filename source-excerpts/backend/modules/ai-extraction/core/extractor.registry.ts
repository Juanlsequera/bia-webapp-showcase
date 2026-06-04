import { Injectable, Logger } from "@nestjs/common";
import type { DocumentExtractor } from "./document-extractor.interface";

/**
 * Registro singleton de extractores de documentos.
 * Los módulos registran sus extractores al arrancar.
 * ExtractorFactory lo usa para resolver por tipo.
 */
@Injectable()
export class ExtractorRegistry {
  private readonly logger = new Logger(ExtractorRegistry.name);
  private readonly map = new Map<string, DocumentExtractor<unknown>>();

  register<T>(extractor: DocumentExtractor<T>): void {
    if (this.map.has(extractor.type)) {
      this.logger.warn(
        `Extractor '${extractor.type}' ya registrado — reemplazando`,
      );
    }
    this.map.set(extractor.type, extractor as DocumentExtractor<unknown>);
    this.logger.log(`Extractor registrado: ${extractor.type}`);
  }

  get<T>(type: string): DocumentExtractor<T> | undefined {
    return this.map.get(type) as DocumentExtractor<T> | undefined;
  }

  listTypes(): string[] {
    return [...this.map.keys()];
  }
}
