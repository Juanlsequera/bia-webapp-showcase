import { Provider, Logger } from "@nestjs/common";
import Redis from "ioredis";

export const AI_EXTRACTION_REDIS = Symbol("AI_EXTRACTION_REDIS");

export const AiExtractionRedisProvider: Provider = {
  provide: AI_EXTRACTION_REDIS,
  useFactory: (): Redis | null => {
    const url = process.env.REDIS_URL;
    const logger = new Logger("AiExtractionRedisProvider");
    if (!url) {
      logger.warn("REDIS_URL no seteada — extracción cache deshabilitado");
      return null;
    }
    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    client.on("connect", () => logger.log("Redis conectado (ai-extraction)"));
    client.on("error", (err) =>
      logger.error(`Redis error (ai-extraction): ${err.message}`),
    );
    return client;
  },
};
