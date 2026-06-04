import { Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { ExtractionController } from "./extraction.controller";
import { ExtractionService } from "./extraction.service";
import { ExtractorRegistry } from "./core/extractor.registry";
import { ExtractorFactory } from "./core/extractor.factory";
import { ExtractionCacheService } from "./core/extraction-cache.service";
import { AiExtractionRedisProvider } from "./redis.provider";

/**
 * Módulo de extracción de datos con IA.
 *
 * Exporta ExtractionService para que otros módulos puedan
 * llamar a extract() directamente (ej: en un flujo admin).
 *
 * Para registrar un extractor desde otro módulo:
 *   import { ExtractorRegistry } from 'modules/ai-extraction/core/extractor.registry';
 *   registry.register(new MiExtractor());
 */
@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB — validación extra en controller
        files: 1,
      },
    }),
  ],
  controllers: [ExtractionController],
  providers: [
    AiExtractionRedisProvider,
    ExtractorRegistry,
    ExtractorFactory,
    ExtractionCacheService,
    ExtractionService,
  ],
  exports: [ExtractionService, ExtractorRegistry],
})
export class AiExtractionModule {}
