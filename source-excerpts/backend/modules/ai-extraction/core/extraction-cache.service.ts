import { Injectable, Inject, Logger } from "@nestjs/common";
import { createHash } from "crypto";
import type Redis from "ioredis";
import { AI_EXTRACTION_REDIS } from "../redis.provider";

const TTL_SECONDS = 24 * 60 * 60; // 24 horas

/**
 * Cache Redis para resultados de extracción.
 * Key: extract:{type}:{sha256(imageBytes)}
 * TTL: 24h
 *
 * Hit rate esperado: alto en testing (mismo cliente reintenta), bajo en prod real.
 * El cache evita llamadas duplicadas al LLM para la misma imagen.
 */
@Injectable()
export class ExtractionCacheService {
  private readonly logger = new Logger(ExtractionCacheService.name);

  constructor(
    @Inject(AI_EXTRACTION_REDIS) private readonly redis: Redis | null,
  ) {}

  private buildKey(type: string, imageBuffer: Buffer): string {
    const hash = createHash("sha256").update(imageBuffer).digest("hex");
    return `extract:${type}:${hash}`;
  }

  async get<T>(type: string, imageBuffer: Buffer): Promise<T | null> {
    if (!this.redis) return null;
    try {
      const key = this.buildKey(type, imageBuffer);
      const cached = await this.redis.get(key);
      if (!cached) return null;
      return JSON.parse(cached) as T;
    } catch (err) {
      this.logger.warn(`Cache read error: ${(err as Error).message}`);
      return null;
    }
  }

  async set(type: string, imageBuffer: Buffer, value: unknown): Promise<void> {
    if (!this.redis) return;
    try {
      const key = this.buildKey(type, imageBuffer);
      await this.redis.set(key, JSON.stringify(value), "EX", TTL_SECONDS);
    } catch (err) {
      this.logger.warn(`Cache write error: ${(err as Error).message}`);
    }
  }

  /** Rate limiting por tenant: X extracciones por hora */
  async checkRateLimit(
    tenantId: string,
    limitPerHour: number,
  ): Promise<boolean> {
    if (!this.redis) return true; // sin Redis, no limitamos
    try {
      const hour = Math.floor(Date.now() / 3_600_000);
      const key = `extract-rate:${tenantId}:${hour}`;
      const count = await this.redis.incr(key);
      if (count === 1) {
        await this.redis.expire(key, 3600);
      }
      return count <= limitPerHour;
    } catch {
      return true; // Redis error → no bloquear
    }
  }
}
