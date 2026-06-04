import { Provider, Logger } from "@nestjs/common";
import Redis from "ioredis";

export const AUTH_REDIS_CLIENT = Symbol("AUTH_REDIS_CLIENT");

/**
 * Provider singleton de ioredis para AuthModule. Mismo patrón que
 * `bcv-rate/redis.provider.ts` y `menu/redis.provider.ts` — cada módulo
 * declara su propio símbolo para mantener independencia.
 *
 * Sin REDIS_URL la app sigue arrancando, pero el flujo de reset-password
 * va a fallar con un mensaje claro: el código necesita persistencia.
 */
export const AuthRedisProvider: Provider = {
  provide: AUTH_REDIS_CLIENT,
  useFactory: (): Redis | null => {
    const url = process.env.REDIS_URL;
    const logger = new Logger("AuthRedisProvider");
    if (!url) {
      logger.warn(
        "REDIS_URL no seteada — reset-password va a estar deshabilitado",
      );
      return null;
    }
    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    client.on("connect", () => logger.log("Redis conectado (Auth)"));
    client.on("error", (err) =>
      logger.error(`Redis error (Auth): ${err.message}`),
    );
    return client;
  },
};
