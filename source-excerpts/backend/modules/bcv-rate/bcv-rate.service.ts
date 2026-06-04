import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { MarketRate, RateCode, RatesSnapshot, UsdRate } from "@foodorder/types";
import { AppLogger } from "../logger/logger.service";
import { REDIS_CLIENT } from "./redis.provider";

const KEY_CURRENT = "bcv:rate:current";
const KEY_LAST_KNOWN = "bcv:rate:last-known";

const TTL_CURRENT_SEC = 60 * 60;
const TTL_LAST_KNOWN_SEC = 7 * 24 * 60 * 60;

const DEFAULT_UPSTREAM_URL = "https://ve.dolarapi.com/v1/dolares/oficial";

const HARD_FALLBACK_RATE = 36;

/** Si la tasa stale supera esto, escalamos a `logError` para que BetterStack alerte. */
const DEFAULT_STALE_ALERT_HOURS = 3;

interface UpstreamResponse {
  fuente?: string;
  nombre?: string;
  promedio?: number;
  fechaActualizacion?: string;
}

// ─── Fuentes para tasas multi-divisa ────────────────────────────────────
//
// USD-BCV reusa el cache existente (KEY_CURRENT/KEY_LAST_KNOWN) para no
// duplicar lecturas ni romper el override manual del admin. El resto vive
// bajo `rates:{code}:current` / `rates:{code}:last-known`.

interface RateSource {
  code: RateCode;
  label: string;
  symbol: string;
  currency: "USD" | "EUR" | "USDT";
  /** URL upstream. Se asume shape estándar dolarapi.com (`promedio` + `fechaActualizacion`). */
  url: string;
  /** Valor hardcoded si upstream + cache fallan. */
  hardFallback: number;
}

const RATE_SOURCES: RateSource[] = [
  {
    code: "USD_BCV",
    label: "USD oficial (BCV)",
    symbol: "$",
    currency: "USD",
    url: "https://ve.dolarapi.com/v1/dolares/oficial",
    hardFallback: HARD_FALLBACK_RATE,
  },
  {
    code: "EUR_BCV",
    label: "EUR oficial (BCV)",
    symbol: "€",
    currency: "EUR",
    url: "https://ve.dolarapi.com/v1/euros/oficial",
    hardFallback: HARD_FALLBACK_RATE * 1.16,
  },
  {
    code: "EUR_PARALELO",
    label: "EUR paralelo",
    symbol: "€",
    currency: "EUR",
    url: "https://ve.dolarapi.com/v1/euros/paralelo",
    hardFallback: HARD_FALLBACK_RATE * 1.56,
  },
  // En Venezuela el "USDT P2P" cotiza al precio del paralelo (es el mismo
  // mercado de facto). dolarapi.com no tiene un endpoint USDT dedicado, así
  // que servimos el paralelo bajo la etiqueta USDT, que es la moneda que
  // realmente le interesa al comerciante.
  {
    code: "USDT",
    label: "USDT (paralelo P2P)",
    symbol: "₮",
    currency: "USDT",
    url: "https://ve.dolarapi.com/v1/dolares/paralelo",
    hardFallback: HARD_FALLBACK_RATE * 1.35,
  },
];

@Injectable()
export class BcvRateService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly logger: AppLogger,
  ) {}

  async getCurrent(): Promise<UsdRate> {
    const cached = await this.safeGet(KEY_CURRENT);
    if (cached) {
      try {
        return JSON.parse(cached) as UsdRate;
      } catch {
        /* json corrupto */
      }
    }

    try {
      const fresh = await this.fetchUpstream();
      await this.safeSet(KEY_CURRENT, JSON.stringify(fresh), TTL_CURRENT_SEC);
      await this.safeSet(
        KEY_LAST_KNOWN,
        JSON.stringify(fresh),
        TTL_LAST_KNOWN_SEC,
      );
      this.logger.log(
        `BCV rate refrescada: 1 USD = ${fresh.value} Bs (publicada ${fresh.capturedAt})`,
        "BcvRateService",
      );
      return fresh;
    } catch (err) {
      this.logger.logError(err, "BcvRateService.fetchUpstream", {
        url: this.upstreamUrl(),
      });
    }

    const stale = await this.safeGet(KEY_LAST_KNOWN);
    if (stale) {
      try {
        const parsed = JSON.parse(stale) as UsdRate;
        // Si es un override manual aún vigente (TTL no expiró), no es realmente "stale" —
        // el admin lo seteó adrede. Lo dejamos pasar sin alertar.
        if (parsed.source === "manual" && parsed.manual_override) {
          return parsed;
        }

        const ageHours = this.ageInHours(parsed.capturedAt);
        const thresholdHours = this.staleAlertThresholdHours();
        const msg = `[BCV-STALE] Sirviendo tasa cacheada (last-known): ${parsed.value} Bs, edad ${ageHours.toFixed(1)}h`;

        // Escalation: si supera el threshold (default 3h), error severity → alerta BetterStack.
        // Si está dentro del threshold, warn (los upstreams rebotan a veces, no es alarmante).
        if (ageHours >= thresholdHours) {
          this.logger.logError(
            new Error(`${msg} (threshold ${thresholdHours}h)`),
            "BcvRateService.getCurrent",
            {
              ageHours,
              thresholdHours,
              value: parsed.value,
              capturedAt: parsed.capturedAt,
            },
          );
        } else {
          this.logger.warn(msg, "BcvRateService.getCurrent");
        }
        return { ...parsed, stale: true };
      } catch {
        /* corrupto */
      }
    }

    this.logger.logError(
      new Error("[BCV-FALLBACK] Sin upstream y sin cache — usando hardcoded"),
      "BcvRateService.getCurrent",
      { hardcoded: HARD_FALLBACK_RATE },
    );
    return {
      value: HARD_FALLBACK_RATE,
      capturedAt: new Date(0).toISOString(),
      stale: true,
      source: "fallback",
    };
  }

  async refresh(): Promise<UsdRate> {
    const fresh = await this.fetchUpstream();
    await this.safeSet(KEY_CURRENT, JSON.stringify(fresh), TTL_CURRENT_SEC);
    await this.safeSet(
      KEY_LAST_KNOWN,
      JSON.stringify(fresh),
      TTL_LAST_KNOWN_SEC,
    );
    this.logger.log(
      `BCV rate forzada: 1 USD = ${fresh.value} Bs`,
      "BcvRateService.refresh",
    );
    return fresh;
  }

  /**
   * Setea una tasa manual con TTL configurable. Mientras esté activa, el GET
   * /bcv-rate devuelve este valor sin tocar el upstream. Cuando expira el TTL,
   * la próxima request reintenta el upstream automáticamente.
   *
   * El admin la usa cuando el upstream está caído por mucho tiempo y la
   * tasa hardcoded (36) no es razonable para el momento.
   */
  async setManualOverride(input: {
    rate: number;
    ttlHours: number;
    reason?: string;
    setBy: string;
  }): Promise<UsdRate> {
    const ttlSec = Math.round(input.ttlHours * 3600);
    const override: UsdRate = {
      value: Math.round(input.rate * 100) / 100,
      capturedAt: new Date().toISOString(),
      stale: false,
      source: "manual",
      manual_override: true,
      set_by: input.setBy,
    };

    await this.safeSet(KEY_CURRENT, JSON.stringify(override), ttlSec);
    // También actualizamos last-known para que el fallback chain no devuelva
    // un valor más viejo que el override si Redis pierde la key current.
    await this.safeSet(
      KEY_LAST_KNOWN,
      JSON.stringify(override),
      TTL_LAST_KNOWN_SEC,
    );

    this.logger.warn(
      `[BCV-OVERRIDE] Tasa manual seteada por ${input.setBy}: 1 USD = ${override.value} Bs ` +
        `(TTL ${input.ttlHours}h)` +
        (input.reason ? ` — Razón: ${input.reason}` : ""),
      "BcvRateService.setManualOverride",
    );
    return override;
  }

  private staleAlertThresholdHours(): number {
    const raw = process.env.BCV_STALE_ALERT_HOURS;
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_STALE_ALERT_HOURS;
  }

  private ageInHours(isoTimestamp: string): number {
    const t = new Date(isoTimestamp).getTime();
    if (!Number.isFinite(t)) return Infinity;
    return (Date.now() - t) / (1000 * 60 * 60);
  }

  private upstreamUrl(): string {
    return process.env.BCV_API_URL ?? DEFAULT_UPSTREAM_URL;
  }

  private async fetchUpstream(): Promise<UsdRate> {
    const url = this.upstreamUrl();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    let body: UpstreamResponse;
    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`BCV upstream HTTP ${res.status}`);
      }
      body = (await res.json()) as UpstreamResponse;
    } finally {
      clearTimeout(timer);
    }

    const value = Number(body.promedio);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`BCV upstream devolvió valor inválido: ${body.promedio}`);
    }

    const capturedAt = body.fechaActualizacion ?? new Date().toISOString();

    return {
      value: Math.round(value * 100) / 100,
      capturedAt,
      stale: false,
      source: "bcv",
    };
  }

  private async safeGet(key: string): Promise<string | null> {
    if (!this.redis) return null;
    try {
      return await this.redis.get(key);
    } catch (err) {
      this.logger.logError(err, "BcvRateService.safeGet", { key });
      return null;
    }
  }

  private async safeSet(
    key: string,
    value: string,
    ttlSeconds: number,
  ): Promise<void> {
    if (!this.redis) return;
    try {
      await this.redis.setex(key, ttlSeconds, value);
    } catch (err) {
      this.logger.logError(err, "BcvRateService.safeSet", { key });
    }
  }

  // ─── Multi-divisa ───────────────────────────────────────────────────────

  /**
   * Devuelve todas las tasas configuradas en paralelo. Nunca tira: cada
   * fuente cae a su cache last-known o a su valor hardcoded.
   *
   * USD_BCV reutiliza el cache existente (`bcv:rate:*`) para respetar
   * overrides manuales del admin. El resto vive bajo `rates:{code}:*`.
   */
  async getAllRates(): Promise<RatesSnapshot> {
    const rates = await Promise.all(
      RATE_SOURCES.map((src) => this.getMarketRate(src)),
    );
    return { rates, fetchedAt: new Date().toISOString() };
  }

  /**
   * Fuerza refresco de todas las tasas saltando el cache. Las que fallen
   * mantienen su last-known o caen a fallback. Devuelve la snapshot final.
   */
  async refreshAllRates(): Promise<RatesSnapshot> {
    await Promise.all(
      RATE_SOURCES.map(async (src) => {
        try {
          const fresh = await this.fetchMarketRate(src);
          await this.safeSet(
            this.cacheKey(src, "current"),
            JSON.stringify(fresh),
            TTL_CURRENT_SEC,
          );
          await this.safeSet(
            this.cacheKey(src, "last-known"),
            JSON.stringify(fresh),
            TTL_LAST_KNOWN_SEC,
          );
        } catch (err) {
          this.logger.logError(err, "BcvRateService.refreshAllRates", {
            code: src.code,
            url: src.url,
          });
        }
      }),
    );
    return this.getAllRates();
  }

  /** Devuelve la tasa de una fuente con el patrón estándar cache→upstream→last-known→fallback. */
  private async getMarketRate(src: RateSource): Promise<MarketRate> {
    // USD_BCV: piggyback sobre el cache existente para respetar override manual.
    if (src.code === "USD_BCV") {
      const usd = await this.getCurrent();
      return {
        code: src.code,
        label: src.label,
        symbol: src.symbol,
        currency: src.currency,
        value: usd.value,
        capturedAt: usd.capturedAt,
        stale: usd.stale,
        source:
          usd.source === "fallback"
            ? "fallback"
            : usd.stale
              ? "cache"
              : "upstream",
      };
    }

    const keyCurrent = this.cacheKey(src, "current");
    const keyLastKnown = this.cacheKey(src, "last-known");

    const cached = await this.safeGet(keyCurrent);
    if (cached) {
      try {
        return JSON.parse(cached) as MarketRate;
      } catch {
        /* corrupto */
      }
    }

    try {
      const fresh = await this.fetchMarketRate(src);
      await this.safeSet(keyCurrent, JSON.stringify(fresh), TTL_CURRENT_SEC);
      await this.safeSet(
        keyLastKnown,
        JSON.stringify(fresh),
        TTL_LAST_KNOWN_SEC,
      );
      return fresh;
    } catch (err) {
      this.logger.warn(
        `[${src.code}] upstream falló — intentando last-known (${err instanceof Error ? err.message : err})`,
        "BcvRateService.getMarketRate",
      );
    }

    const stale = await this.safeGet(keyLastKnown);
    if (stale) {
      try {
        const parsed = JSON.parse(stale) as MarketRate;
        return { ...parsed, stale: true, source: "cache" };
      } catch {
        /* corrupto */
      }
    }

    return {
      code: src.code,
      label: src.label,
      symbol: src.symbol,
      currency: src.currency,
      value: src.hardFallback,
      capturedAt: new Date(0).toISOString(),
      stale: true,
      source: "fallback",
    };
  }

  private async fetchMarketRate(src: RateSource): Promise<MarketRate> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);

    let body: UpstreamResponse;
    try {
      const res = await fetch(src.url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      if (!res.ok) throw new Error(`${src.code} upstream HTTP ${res.status}`);
      body = (await res.json()) as UpstreamResponse;
    } finally {
      clearTimeout(timer);
    }

    const value = Number(body.promedio);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `${src.code} upstream devolvió valor inválido: ${body.promedio}`,
      );
    }

    return {
      code: src.code,
      label: src.label,
      symbol: src.symbol,
      currency: src.currency,
      value: Math.round(value * 100) / 100,
      capturedAt: body.fechaActualizacion ?? new Date().toISOString(),
      stale: false,
      source: "upstream",
    };
  }

  private cacheKey(src: RateSource, kind: "current" | "last-known"): string {
    return `rates:${src.code.toLowerCase()}:${kind}`;
  }
}
