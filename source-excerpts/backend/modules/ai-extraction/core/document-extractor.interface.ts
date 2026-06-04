import { z } from "zod";

export interface ExtractionContext {
  tenantId?: string;
  /** Monto esperado en Bs (para sanity check en PagoMóvil) */
  expectedAmount?: number;
  /** Teléfono beneficiario esperado (para sanity check en PagoMóvil) */
  expectedBeneficiaryPhone?: string;
}

/**
 * Define un tipo de documento extraíble.
 * Implementar una clase por tipo de documento (pagomovil-receipt, zelle-receipt, etc.).
 * La clase se registra en ExtractorRegistry al bootstrap del módulo.
 *
 * Patrón Open/Closed: agregar un extractor nuevo = crear este archivo + registrarlo.
 * No se toca ExtractionService ni ExtractionController.
 */
export interface DocumentExtractor<T> {
  /** Identificador único — se usa en la URL: POST /:slug/extract/:type */
  readonly type: string;

  /** Schema Zod del output esperado — usado para validar la respuesta del LLM */
  readonly schema: z.ZodSchema<T>;

  /**
   * Schema JSON (sin Zod) para el structured output del LLM.
   * Cada provider lo adapta a su formato nativo.
   */
  buildJsonSchema(): Record<string, unknown>;

  /** Construye el prompt para el LLM, opcionalmente enriquecido con contexto */
  buildPrompt(context?: ExtractionContext): string;

  /** Hook opcional: normalizar / enriquecer después de validar el schema */
  postProcess?(raw: T, context?: ExtractionContext): T | Promise<T>;

  /** Tamaño máximo de imagen en bytes (default 5MB) */
  readonly maxImageBytes?: number;

  /** Si requiere JWT para ser llamado (false = cliente final puede usarlo) */
  readonly requiresAuth: boolean;
}
