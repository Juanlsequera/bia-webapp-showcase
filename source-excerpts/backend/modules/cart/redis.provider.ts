import { Provider, Logger } from "@nestjs/common";
import Redis from "ioredis";

export const CART_REDIS_CLIENT = Symbol("CART_REDIS_CLIENT");

/**
 * Provider de ioredis para CartModule.
 * Si REDIS_URL no está configurada, el servicio opera sin persistencia
 * (el carrito vive solo en memoria del cliente — comportamiento original).
 */
export const CartRedisProvider: Provider = {
  provide: CART_REDIS_CLIENT,
  useFactory: (): Redis | null => {
    const url = process.env.REDIS_URL;
    const logger = new Logger("CartRedisProvider");
    if (!url) {
      logger.warn("REDIS_URL no seteada — cart persistence deshabilitada");
      return null;
    }
    const client = new Redis(url, {
      maxRetriesPerRequest: 3,
      lazyConnect: false,
      enableOfflineQueue: false,
    });
    client.on("connect", () => logger.log("Redis conectado (Cart)"));
    client.on("error", (err) =>
      logger.error(`Redis error (Cart): ${err.message}`),
    );
    return client;
  },
};
