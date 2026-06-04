import { Injectable, Inject } from "@nestjs/common";
import type Redis from "ioredis";
import { CART_REDIS_CLIENT } from "./redis.provider";
import { AppLogger } from "../logger/logger.service";
import { SaveCartDto, CartItemDto } from "./dto/cart.dto";

/**
 * CartService — persiste el carrito del cliente en Redis.
 *
 * Key:   cart:{tenantId}:{tableNumber}    TTL: 7200s (2h)
 * Value: JSON array de CartItemDto
 *
 * Si Redis no está disponible (null client) todos los métodos devuelven
 * valores vacíos / success sin efecto — degradación silenciosa.
 */
@Injectable()
export class CartService {
  private readonly TTL = 7200; // 2 horas

  constructor(
    @Inject(CART_REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly logger: AppLogger,
  ) {}

  private key(tenantId: string, tableNumber: string): string {
    return `cart:${tenantId}:${tableNumber}`;
  }

  /** Obtiene el carrito actual. Devuelve [] si no existe o Redis está caído. */
  async getCart(tenantId: string, tableNumber: string): Promise<CartItemDto[]> {
    if (!this.redis) return [];
    try {
      const raw = await this.redis.get(this.key(tenantId, tableNumber));
      if (!raw) return [];
      return JSON.parse(raw) as CartItemDto[];
    } catch (err) {
      this.logger.logError(err, "CartService.getCart", {
        tenantId,
        tableNumber,
      });
      return [];
    }
  }

  /** Guarda (reemplaza) el carrito completo. TTL se resetea a 2h. */
  async saveCart(
    tenantId: string,
    tableNumber: string,
    dto: SaveCartDto,
  ): Promise<{ saved: true }> {
    if (!this.redis) return { saved: true };
    try {
      await this.redis.setex(
        this.key(tenantId, tableNumber),
        this.TTL,
        JSON.stringify(dto.items),
      );
    } catch (err) {
      this.logger.logError(err, "CartService.saveCart", {
        tenantId,
        tableNumber,
      });
    }
    return { saved: true };
  }

  /** Elimina el carrito (se llama cuando el pedido se confirma). */
  async clearCart(
    tenantId: string,
    tableNumber: string,
  ): Promise<{ cleared: true }> {
    if (!this.redis) return { cleared: true };
    try {
      await this.redis.del(this.key(tenantId, tableNumber));
    } catch (err) {
      this.logger.logError(err, "CartService.clearCart", {
        tenantId,
        tableNumber,
      });
    }
    return { cleared: true };
  }
}
