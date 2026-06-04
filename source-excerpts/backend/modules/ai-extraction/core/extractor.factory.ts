import { Injectable, BadRequestException } from "@nestjs/common";
import type { DocumentExtractor } from "./document-extractor.interface";
import { ExtractorRegistry } from "./extractor.registry";

/**
 * Resuelve un DocumentExtractor por tipo.
 * Lanza 400 si el tipo no está registrado.
 */
@Injectable()
export class ExtractorFactory {
  constructor(private readonly registry: ExtractorRegistry) {}

  get<T>(type: string): DocumentExtractor<T> {
    const extractor = this.registry.get<T>(type);
    if (!extractor) {
      throw new BadRequestException(
        `Tipo de extracción desconocido: '${type}'. Tipos disponibles: ${this.registry.listTypes().join(", ")}`,
      );
    }
    return extractor;
  }
}
