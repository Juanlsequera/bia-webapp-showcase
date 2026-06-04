import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
  UnprocessableEntityException,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { ZodError } from "zod";
import type { LLMProvider } from "./core/llm-provider.interface";
import type { ExtractionContext } from "./core/document-extractor.interface";
import { ExtractorFactory } from "./core/extractor.factory";
import { ExtractorRegistry } from "./core/extractor.registry";
import { ExtractionCacheService } from "./core/extraction-cache.service";
import { createLLMProvider } from "./providers/provider.factory";
import { registerAllExtractors } from "./extractors";

const RATE_LIMIT_PER_HOUR = Number(
  process.env.AI_EXTRACTION_RATE_LIMIT_PER_HOUR ?? 50,
);

export interface ExtractionResult<T = unknown> {
  type: string;
  data: T;
  cached: boolean;
  provider: string;
  latencyMs: number;
}

@Injectable()
export class ExtractionService implements OnModuleInit {
  private readonly logger = new Logger(ExtractionService.name);
  private provider!: LLMProvider;

  constructor(
    private readonly registry: ExtractorRegistry,
    private readonly factory: ExtractorFactory,
    private readonly cache: ExtractionCacheService,
  ) {}

  onModuleInit(): void {
    // Registrar extractores y resolver el provider al arranque
    registerAllExtractors(this.registry);
    this.provider = createLLMProvider();
    this.logger.log(`Provider activo: ${this.provider.name}`);
  }

  async extract<T>(
    type: string,
    imageBuffer: Buffer,
    mimeType: string,
    context?: ExtractionContext,
  ): Promise<ExtractionResult<T>> {
    const extractor = this.factory.get<T>(type);
    const start = Date.now();

    // Rate limit por tenant
    if (context?.tenantId) {
      const allowed = await this.cache.checkRateLimit(
        context.tenantId,
        RATE_LIMIT_PER_HOUR,
      );
      if (!allowed) {
        throw new HttpException(
          `Límite de extracciones alcanzado (${RATE_LIMIT_PER_HOUR}/hora). Intentá más tarde.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    }

    // Cache lookup
    const cached = await this.cache.get<T>(type, imageBuffer);
    if (cached !== null) {
      this.logger.debug(`Cache hit: ${type}`);
      return {
        type,
        data: cached,
        cached: true,
        provider: this.provider.name,
        latencyMs: 0,
      };
    }

    // Llamada al LLM
    let raw: T;
    try {
      raw = await this.provider.extract<T>({
        image: imageBuffer,
        mimeType,
        schema: extractor.schema,
        jsonSchema: extractor.buildJsonSchema(),
        prompt: extractor.buildPrompt(context),
      });
    } catch (err) {
      this.logger.error(`LLM error (${type}): ${(err as Error).message}`);
      throw new ServiceUnavailableException(
        `El servicio de extracción no está disponible: ${(err as Error).message}`,
      );
    }

    // Schema validation (el provider ya debería haber validado, pero double-check)
    let validated: T;
    try {
      validated = extractor.schema.parse(raw);
    } catch (err) {
      this.logger.warn(
        `Schema validation failed (${type}): ${(err as ZodError).message}`,
      );
      throw new UnprocessableEntityException(
        "El modelo devolvió datos con formato inválido",
      );
    }

    // postProcess hook
    if (extractor.postProcess) {
      validated = (await extractor.postProcess(validated, context)) as T;
    }

    // Cachear resultado
    await this.cache.set(type, imageBuffer, validated);

    const latencyMs = Date.now() - start;
    this.logger.log(
      `Extracción OK: ${type} | ${this.provider.name} | ${latencyMs}ms`,
    );

    return {
      type,
      data: validated,
      cached: false,
      provider: this.provider.name,
      latencyMs,
    };
  }
}
