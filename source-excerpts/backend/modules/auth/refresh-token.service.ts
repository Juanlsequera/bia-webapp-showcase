import {
  Inject,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import * as crypto from "crypto";
import type Redis from "ioredis";
import { JwtPayload, AuthUser, UserRole } from "@foodorder/types";
import { AppLogger } from "../logger/logger.service";
import { AUTH_REDIS_CLIENT } from "./redis.provider";

/**
 * Manejo de pares access/refresh con familias de sesión.
 *
 * Diseño:
 * - Cada login emite un par y crea una "familia" (sesión). Multi-sesión por
 *   default — un mismo usuario puede tener varias familias activas.
 * - El refresh rota: cada uso emite un par nuevo y reemplaza el actual de la
 *   familia. El refresh viejo queda inválido.
 * - Si llega un refresh que NO coincide con el current de su familia → reuso
 *   detectado (señal de robo). Se borra TODA la familia.
 * - Logout borra la familia + blacklistea el access actual hasta su exp.
 *
 * Keys Redis (todas bajo el prefijo `auth:`):
 *   auth:family:{familyId}      → JSON metadata de la sesión (TTL = refresh TTL)
 *   auth:refresh:{refreshHash}  → familyId (lookup rápido, TTL = refresh TTL)
 *   auth:blacklist:{accessJti}  → "1" (TTL = tiempo restante del access)
 *
 * El refresh token raw nunca se guarda — solo su SHA-256.
 */
@Injectable()
export class RefreshTokenService {
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly logger: AppLogger,
    @Inject(AUTH_REDIS_CLIENT) private readonly redis: Redis | null,
  ) {
    this.accessTtlSec = parseTtl(process.env.JWT_EXPIRES_IN ?? "10h");
    this.refreshTtlSec = parseTtl(
      process.env.REFRESH_TOKEN_EXPIRES_IN ?? "30d",
    );
  }

  // ── Helpers públicos ──────────────────────────────────────────────────

  getAccessTtlSec(): number {
    return this.accessTtlSec;
  }

  getRefreshTtlSec(): number {
    return this.refreshTtlSec;
  }

  /**
   * Genera un par nuevo y crea una familia. Se llama desde login.
   */
  async issueTokenPair(user: {
    _id: string;
    email: string;
    role: UserRole;
    tenantId?: string;
  }): Promise<{ accessToken: string; refreshToken: string; familyId: string }> {
    this.assertRedis();

    const familyId = crypto.randomUUID();
    return this.mintPair(user, familyId);
  }

  /**
   * Rota el par usando un refresh válido. Detecta reuso.
   */
  async rotate(refreshToken: string): Promise<{
    accessToken: string;
    refreshToken: string;
    familyId: string;
    user: AuthUser;
  }> {
    this.assertRedis();

    const refreshHash = hashToken(refreshToken);
    const familyId = await this.redis!.get(this.refreshKey(refreshHash));
    if (!familyId) {
      throw new UnauthorizedException("Refresh token inválido o expirado");
    }

    const familyRaw = await this.redis!.get(this.familyKey(familyId));
    if (!familyRaw) {
      // El refresh apuntaba a una familia que ya no existe (TTL o revocada).
      await this.redis!.del(this.refreshKey(refreshHash));
      throw new UnauthorizedException("Sesión cerrada");
    }

    let family: FamilyMeta;
    try {
      family = JSON.parse(familyRaw) as FamilyMeta;
    } catch {
      await this.revokeFamily(familyId);
      throw new UnauthorizedException("Sesión corrupta");
    }

    // Reuse detection — si el refresh no coincide con el current de la familia,
    // alguien usó un refresh viejo. Asumimos robo y matamos la familia entera.
    if (family.currentRefreshHash !== refreshHash) {
      this.logger.warn(
        `[auth] Reuso de refresh detectado en family ${familyId} (user ${family.userId}). Sesión cerrada.`,
        "RefreshTokenService",
      );
      await this.revokeFamily(familyId);
      throw new UnauthorizedException(
        "Sesión cerrada por actividad sospechosa",
      );
    }

    // Blacklisteamos el access viejo por el tiempo que le queda — si todavía
    // no expiró naturalmente, no queremos que siga válido tras la rotación.
    if (family.currentAccessJti) {
      await this.blacklistAccess(family.currentAccessJti, this.accessTtlSec);
    }

    const user = {
      _id: family.userId,
      email: family.email,
      role: family.role,
      tenantId: family.tenantId,
    };

    // Emitir par nuevo en la MISMA familia (reusamos familyId).
    const pair = await this.mintPair(user, familyId);

    // Borrar el lookup del refresh viejo.
    await this.redis!.del(this.refreshKey(refreshHash));

    return { ...pair, user };
  }

  /**
   * Cierra la sesión (familia) y blacklistea el access actual.
   * Si el refresh ya no existe, igual responde OK (idempotente).
   */
  async revoke(refreshToken: string): Promise<void> {
    if (!this.redis) return; // sin redis, nada que limpiar

    const refreshHash = hashToken(refreshToken);
    const familyId = await this.redis.get(this.refreshKey(refreshHash));
    if (!familyId) return;

    await this.revokeFamily(familyId);
  }

  /**
   * Consulta blacklist — usado por JwtStrategy en cada request protegido.
   * Si Redis está caído, hace fail-open (permite el token) para no tirar
   * toda la app — preferimos disponibilidad sobre revocación inmediata
   * (el access expira en {accessTtlSec} segundos máximo igual).
   */
  async isAccessBlacklisted(jti: string): Promise<boolean> {
    if (!this.redis || !jti) return false;
    try {
      const v = await this.redis.get(this.blacklistKey(jti));
      return v === "1";
    } catch (err) {
      this.logger.warn(
        `[auth] Redis caído al consultar blacklist — fail-open: ${(err as Error).message}`,
        "RefreshTokenService",
      );
      return false;
    }
  }

  // ── Internos ─────────────────────────────────────────────────────────

  private async mintPair(
    user: { _id: string; email: string; role: UserRole; tenantId?: string },
    familyId: string,
  ): Promise<{ accessToken: string; refreshToken: string; familyId: string }> {
    const jti = crypto.randomUUID();
    const payload: JwtPayload = {
      sub: user._id,
      email: user.email,
      role: user.role,
      ...(user.tenantId && { tenantId: user.tenantId }),
    };
    const accessToken = this.jwtService.sign(payload, { jwtid: jti });
    const refreshToken = generateRefreshToken();
    const refreshHash = hashToken(refreshToken);

    const meta: FamilyMeta = {
      userId: user._id,
      email: user.email,
      role: user.role,
      tenantId: user.tenantId,
      currentRefreshHash: refreshHash,
      currentAccessJti: jti,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    };

    // Pipeline para escritura atómica de los 2 keys con mismo TTL.
    const pipeline = this.redis!.pipeline();
    pipeline.setex(
      this.familyKey(familyId),
      this.refreshTtlSec,
      JSON.stringify(meta),
    );
    pipeline.setex(this.refreshKey(refreshHash), this.refreshTtlSec, familyId);
    await pipeline.exec();

    return { accessToken, refreshToken, familyId };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    if (!this.redis) return;
    const familyRaw = await this.redis.get(this.familyKey(familyId));
    if (familyRaw) {
      try {
        const family = JSON.parse(familyRaw) as FamilyMeta;
        if (family.currentAccessJti) {
          await this.blacklistAccess(
            family.currentAccessJti,
            this.accessTtlSec,
          );
        }
        if (family.currentRefreshHash) {
          await this.redis.del(this.refreshKey(family.currentRefreshHash));
        }
      } catch {
        // family corrupta — al menos borramos la key.
      }
    }
    await this.redis.del(this.familyKey(familyId));
  }

  private async blacklistAccess(jti: string, ttlSec: number): Promise<void> {
    if (!this.redis || !jti) return;
    try {
      await this.redis.setex(this.blacklistKey(jti), ttlSec, "1");
    } catch (err) {
      this.logger.warn(
        `[auth] Redis caído al blacklistear ${jti}: ${(err as Error).message}`,
        "RefreshTokenService",
      );
    }
  }

  private assertRedis(): void {
    if (!this.redis) {
      throw new ServiceUnavailableException(
        "Auth no disponible: Redis no configurado (REDIS_URL)",
      );
    }
  }

  private familyKey(familyId: string): string {
    return `auth:family:${familyId}`;
  }

  private refreshKey(hash: string): string {
    return `auth:refresh:${hash}`;
  }

  private blacklistKey(jti: string): string {
    return `auth:blacklist:${jti}`;
  }
}

interface FamilyMeta {
  userId: string;
  email: string;
  role: UserRole;
  tenantId?: string;
  currentRefreshHash: string;
  currentAccessJti: string;
  createdAt: number;
  lastUsedAt: number;
}

// ── Helpers de módulo ──────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function generateRefreshToken(): string {
  // 32 bytes = 256 bits de entropía. base64url para evitar caracteres
  // especiales en transporte HTTP.
  return crypto.randomBytes(32).toString("base64url");
}

/**
 * Parsea expresiones tipo "10h", "30d", "15m", "3600s" a segundos.
 * Acepta también números puros (asumiendo segundos).
 * Default si no parsea: 600 (10min) — fail-safe.
 */
function parseTtl(input: string): number {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
  const m = trimmed.match(/^(\d+)\s*([smhd])$/i);
  if (!m) return 600;
  const n = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case "s":
      return n;
    case "m":
      return n * 60;
    case "h":
      return n * 3600;
    case "d":
      return n * 86400;
    default:
      return 600;
  }
}
