import { Logger } from "@nestjs/common";
import { z } from "zod";
import type { LLMProvider } from "../core/llm-provider.interface";

/**
 * Provider Claude (Anthropic) — opcional, fallback o alternativa.
 *
 * Usa Claude Haiku 4.5 que es el más barato con visión.
 * Structured output via tool_use (más fiable que JSON mode puro).
 *
 * No requiere instalar @anthropic-ai/sdk — usa fetch nativo para mantener
 * la dependencia ligera. Si se necesita más features, migrar al SDK.
 *
 * Activar: LLM_PROVIDER=claude + CLAUDE_API_KEY en .env
 */
export class ClaudeProvider implements LLMProvider {
  readonly name = "claude" as const;
  private readonly apiKey: string;
  private readonly modelName: string;
  private readonly logger = new Logger(ClaudeProvider.name);

  constructor() {
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) throw new Error("CLAUDE_API_KEY no configurada");
    this.apiKey = apiKey;
    this.modelName = process.env.CLAUDE_MODEL ?? "claude-haiku-4-5-20251001";
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
      maxRetries = 2,
      timeoutMs = 20_000,
    } = input;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const tid = setTimeout(() => controller.abort(), timeoutMs);

        const body = {
          model: this.modelName,
          max_tokens: 1024,
          tools: [
            {
              name: "extract_data",
              description:
                "Extraer datos estructurados de la imagen según el schema",
              input_schema: jsonSchema,
            },
          ],
          tool_choice: { type: "tool", name: "extract_data" },
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: mimeType,
                    data: image.toString("base64"),
                  },
                },
                { type: "text", text: prompt },
              ],
            },
          ],
        };

        const res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": this.apiKey,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        clearTimeout(tid);

        if (!res.ok) {
          throw new Error(`Claude API ${res.status}: ${await res.text()}`);
        }

        const data = (await res.json()) as {
          content: { type: string; input?: unknown }[];
        };
        const toolUse = data.content.find((c) => c.type === "tool_use");
        if (!toolUse?.input) throw new Error("Claude no devolvió tool_use");

        return schema.parse(toolUse.input);
      } catch (err) {
        lastError = err as Error;
        this.logger.warn(
          `Claude intento ${attempt + 1}/${maxRetries + 1} fallido: ${lastError.message}`,
        );
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }
      }
    }

    throw lastError ?? new Error("ClaudeProvider: extracción fallida");
  }
}
