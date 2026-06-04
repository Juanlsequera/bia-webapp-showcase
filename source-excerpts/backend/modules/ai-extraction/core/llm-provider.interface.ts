import { z } from "zod";

/**
 * Abstracción mínima de un provider LLM con visión.
 * Una implementación por proveedor (Gemini, Claude, OpenAI).
 * El provider se encarga de: autenticación, formato de la imagen,
 * structured output, reintentos y timeout.
 */
export interface LLMProvider {
  readonly name: "gemini" | "claude" | "openai";

  /**
   * Extrae datos estructurados de una imagen.
   *
   * @param image      Buffer de la imagen
   * @param mimeType   MIME type de la imagen (image/jpeg, image/png, etc.)
   * @param schema     Schema Zod para validar el output del LLM
   * @param jsonSchema Schema JSON serializable para el structured output del LLM
   * @param prompt     Prompt de extracción
   * @param maxRetries Cantidad máxima de reintentos ante fallos (default 2)
   * @param timeoutMs  Timeout en ms por intento (default 15000)
   */
  extract<T>(input: {
    image: Buffer;
    mimeType: string;
    schema: z.ZodSchema<T>;
    jsonSchema: Record<string, unknown>;
    prompt: string;
    maxRetries?: number;
    timeoutMs?: number;
  }): Promise<T>;
}
