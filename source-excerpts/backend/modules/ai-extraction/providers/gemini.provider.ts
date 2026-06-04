import { Logger, ServiceUnavailableException } from "@nestjs/common";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";
import type { LLMProvider } from "../core/llm-provider.interface";

/**
 * Provider Gemini — default.
 * Usa Gemini 2.0 Flash (configurable vía GEMINI_MODEL).
 * Free tier: 250 req/día, 10 RPM (suficiente para early stage).
 *
 * Structured output: responseSchema nativo → sin regex parsing, respuesta directa JSON.
 */
export class GeminiProvider implements LLMProvider {
  readonly name = "gemini" as const;
  private readonly client: GoogleGenerativeAI | null;
  private readonly modelName: string;
  private readonly logger = new Logger(GeminiProvider.name);

  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      // Sin API key el módulo arranca en modo degradado: loguea un warn y deshabilita
      // la extracción. El app no crashea — igual que MediaService y PushService.
      this.logger.warn(
        "GEMINI_API_KEY no configurada — extracción AI deshabilitada. Setear en producción.",
      );
      this.client = null;
    } else {
      this.client = new GoogleGenerativeAI(apiKey);
    }
    this.modelName = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";
  }

  async extract<T>(input: {
    image: Buffer;
    mimeType: string;
    schema: z.ZodSchema<T>;
    jsonSchema: Record<string, unknown>;
    prompt: string;
    maxRetries?: number;
    timeoutMs?: number;
  }): Promise<T> {
    const {
      image,
      mimeType,
      schema,
      jsonSchema,
      prompt,
      maxRetries = 1,
      timeoutMs = 12_000,
    } = input;

    if (!this.client) {
      throw new ServiceUnavailableException(
        "Extracción AI no disponible: GEMINI_API_KEY no configurada",
      );
    }

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const model = this.client.getGenerativeModel({
          model: this.modelName,
          generationConfig: {
            responseMimeType: "application/json",
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            responseSchema: jsonSchema as any,
          },
        });

        const imagePart = {
          inlineData: {
            data: image.toString("base64"),
            mimeType,
          },
        };

        const resultPromise = model.generateContent([prompt, imagePart]);
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Gemini timeout (${timeoutMs}ms)`)),
            timeoutMs,
          ),
        );

        const result = await Promise.race([resultPromise, timeoutPromise]);
        const text = result.response.text();
        const raw: unknown = JSON.parse(text);
        return schema.parse(raw);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `Gemini intento ${attempt + 1}/${maxRetries + 1} fallido: ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error("GeminiProvider: extracción fallida");
  }
}
