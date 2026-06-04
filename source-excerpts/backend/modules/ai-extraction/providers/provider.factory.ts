import { Logger } from "@nestjs/common";
import type { LLMProvider } from "../core/llm-provider.interface";
import { GeminiProvider } from "./gemini.provider";
import { ClaudeProvider } from "./claude.provider";

/**
 * Instancia el provider LLM según la variable de entorno LLM_PROVIDER.
 * Default: gemini.
 *
 * Para agregar un nuevo provider:
 * 1. Implementar LLMProvider en providers/<nombre>.provider.ts
 * 2. Agregar el case acá
 * 3. Setear LLM_PROVIDER=<nombre> en .env
 */
export function createLLMProvider(): LLMProvider {
  const providerName = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  const logger = new Logger("ProviderFactory");

  switch (providerName) {
    case "gemini":
      logger.log("LLM Provider: Gemini");
      return new GeminiProvider();
    case "claude":
      logger.log("LLM Provider: Claude (Anthropic)");
      return new ClaudeProvider();
    default:
      logger.warn(`LLM_PROVIDER='${providerName}' desconocido — usando Gemini`);
      return new GeminiProvider();
  }
}
