import { Provider, Logger } from "@nestjs/common";
import Redis from "ioredis";

export const REDIS_CLIENT = Symbol("BCV_REDIS_CLIENT");

/**
 * Provider singleton de ioredis para BcvRateModule.
 *
 * Nota: por ahora cada módulo que necesita Redis declara su propio provider
 * con un símbolo distinto (ver `menu/redis.provider.ts`). Cuando hayan 3+
 * consumidores conviene extraer un `RedisModule` global; mientras tanto este
 * patrón mantiene los módulos independientes y testeables sin acoplamiento.
 *
 * Si `REDIS_URL` no está seteada, loguea warning y el servicio sigue sin
 * cache (cae directo al upstream y al fallback hardcoded).
 */
export const RedisProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: (): Redis | null => {
    const url = process.env.REDIS_URL;
    const logger = new Logger("BcvRedisProvider");
    if (!url) {
      logger.warn("REDIS_URL no seteada — BCV cache deshabilitado");
      return null;
    }
    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    client.on("connect", () => logger.log("Redis conectado (BCV)"));
    client.on("error", (err) =>
      logger.error(`Redis error (BCV): ${err.message}`),
    );
    return client;
  },
};
