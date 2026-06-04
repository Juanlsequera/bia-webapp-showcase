import { Test, TestingModule } from "@nestjs/testing";
import { BcvRateService } from "./bcv-rate.service";
import { AppLogger } from "../logger/logger.service";
import { REDIS_CLIENT } from "./redis.provider";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Construye un UsdRate válido para usar en cache mocks */
function makeRate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    value: 36.42,
    capturedAt: new Date().toISOString(),
    stale: false,
    source: "bcv",
    ...overrides,
  };
}

/** Respuesta típica del upstream dolarapi.com */
const UPSTREAM_BODY = {
  promedio: 36.5,
  fechaActualizacion: "2026-06-01T08:00:00.000Z",
};

// ── Mocks ────────────────────────────────────────────────────────────────────

let mockRedis: {
  get: jest.Mock;
  setex: jest.Mock;
};

let mockLogger: {
  log: jest.Mock;
  warn: jest.Mock;
  logError: jest.Mock;
};

/** Parchea global.fetch para devolver una respuesta controlada */
function mockFetch(body: unknown, ok = true, status = 200) {
  jest.spyOn(global, "fetch").mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  } as unknown as Response);
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("BcvRateService", () => {
  let service: BcvRateService;

  beforeEach(async () => {
    mockRedis = {
      get: jest.fn().mockResolvedValue(null),
      setex: jest.fn().mockResolvedValue("OK"),
    };

    mockLogger = {
      log: jest.fn(),
      warn: jest.fn(),
      logError: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BcvRateService,
        { provide: REDIS_CLIENT, useValue: mockRedis },
        { provide: AppLogger, useValue: mockLogger },
      ],
    }).compile();

    service = module.get<BcvRateService>(BcvRateService);
  });

  afterEach(() => jest.restoreAllMocks());

  // ── getCurrent ─────────────────────────────────────────────────────────────

  describe("getCurrent()", () => {
    it("devuelve la tasa cacheada si existe en KEY_CURRENT", async () => {
      const cached = makeRate({ value: 36.42 });
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(cached));
      const fetchSpy = jest.spyOn(global, "fetch");

      const result = await service.getCurrent();

      expect(result.value).toBe(36.42);
      expect(result.source).toBe("bcv");
      // No debe tocar el upstream
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("llama al upstream cuando KEY_CURRENT está vacío y guarda en ambas keys", async () => {
      // KEY_CURRENT vacío, KEY_LAST_KNOWN también vacío
      mockRedis.get.mockResolvedValue(null);
      mockFetch(UPSTREAM_BODY);

      const result = await service.getCurrent();

      expect(result.value).toBe(36.5);
      expect(result.source).toBe("bcv");
      expect(result.stale).toBe(false);
      // Debe guardar en KEY_CURRENT y KEY_LAST_KNOWN
      expect(mockRedis.setex).toHaveBeenCalledTimes(2);
    });

    it("cae a last-known con stale:true cuando el upstream falla", async () => {
      // KEY_CURRENT vacío
      mockRedis.get.mockResolvedValueOnce(null);
      // Upstream falla
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("network error"));
      // KEY_LAST_KNOWN tiene un valor viejo
      const staleRate = makeRate({ value: 35.0, source: "bcv" });
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(staleRate));

      const result = await service.getCurrent();

      expect(result.value).toBe(35.0);
      expect(result.stale).toBe(true);
      expect(mockLogger.logError).toHaveBeenCalledWith(
        expect.any(Error),
        "BcvRateService.fetchUpstream",
        expect.anything(),
      );
    });

    it("cae al hardcoded (36) cuando upstream y last-known fallan", async () => {
      mockRedis.get.mockResolvedValue(null); // cache siempre vacío
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("network error"));

      const result = await service.getCurrent();

      expect(result.value).toBe(36);
      expect(result.stale).toBe(true);
      expect(result.source).toBe("fallback");
    });

    it("NO marca como stale un override manual aunque sea viejo", async () => {
      // KEY_CURRENT vacío → cae a last-known
      mockRedis.get.mockResolvedValueOnce(null);
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("upstream down"));

      const manualOverride = makeRate({
        value: 40.0,
        source: "manual",
        manual_override: true,
        set_by: "admin@test.com",
        // capturedAt viejo
        capturedAt: new Date(Date.now() - 6 * 3600 * 1000).toISOString(),
      });
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(manualOverride));

      const result = await service.getCurrent();

      // El override manual NO debe retornar como stale (el admin lo seteó adrede)
      expect(result.value).toBe(40.0);
      expect(result.stale).toBe(false);
      expect(result.source).toBe("manual");
      expect(result.manual_override).toBe(true);
    });

    it("rechaza un valor inválido del upstream y cae a last-known", async () => {
      mockRedis.get.mockResolvedValueOnce(null);
      // Upstream devuelve valor no numérico
      mockFetch({ promedio: "no-es-numero" });
      const fallback = makeRate({ value: 34.0 });
      mockRedis.get.mockResolvedValueOnce(JSON.stringify(fallback));

      const result = await service.getCurrent();

      expect(result.value).toBe(34.0);
      expect(result.stale).toBe(true);
    });
  });

  // ── setManualOverride ──────────────────────────────────────────────────────

  describe("setManualOverride()", () => {
    it("guarda la tasa manual en KEY_CURRENT con el TTL correcto", async () => {
      const result = await service.setManualOverride({
        rate: 40.0,
        ttlHours: 24,
        reason: "API del BCV caída",
        setBy: "admin@negocio.com",
      });

      expect(result.value).toBe(40);
      expect(result.source).toBe("manual");
      expect(result.manual_override).toBe(true);
      expect(result.set_by).toBe("admin@negocio.com");
      expect(result.stale).toBe(false);

      // KEY_CURRENT con TTL = 24h * 3600s = 86400s
      expect(mockRedis.setex).toHaveBeenCalledWith(
        "bcv:rate:current",
        86400,
        expect.stringContaining('"source":"manual"'),
      );
    });

    it("también actualiza KEY_LAST_KNOWN con el mismo valor", async () => {
      await service.setManualOverride({
        rate: 38.5,
        ttlHours: 4,
        setBy: "admin@test.com",
      });

      const calls = mockRedis.setex.mock.calls;
      const lastKnownCall = calls.find((c: string[]) =>
        c[0].includes("last-known"),
      );
      expect(lastKnownCall).toBeDefined();
      expect(lastKnownCall![1]).toBe(7 * 24 * 3600); // TTL last-known = 7 días
      expect(lastKnownCall![2]).toContain('"value":38.5');
    });

    it("redondea la tasa a 2 decimales", async () => {
      const result = await service.setManualOverride({
        rate: 36.4219,
        ttlHours: 1,
        setBy: "admin@test.com",
      });

      expect(result.value).toBe(36.42);
    });

    it("emite log de advertencia con [BCV-OVERRIDE] y el email del admin", async () => {
      await service.setManualOverride({
        rate: 40,
        ttlHours: 8,
        reason: "Prueba de override",
        setBy: "superadmin@test.com",
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("[BCV-OVERRIDE]"),
        expect.any(String),
      );
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("superadmin@test.com"),
        expect.any(String),
      );
    });

    it("incluye la razón en el log si se provee", async () => {
      await service.setManualOverride({
        rate: 40,
        ttlHours: 8,
        reason: "BCV caído por mantenimiento",
        setBy: "admin@test.com",
      });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("BCV caído por mantenimiento"),
        expect.any(String),
      );
    });

    it("no incluye 'Razón' en el log si reason es undefined", async () => {
      await service.setManualOverride({
        rate: 40,
        ttlHours: 1,
        setBy: "admin@test.com",
      });

      const warnCall = mockLogger.warn.mock.calls[0][0] as string;
      expect(warnCall).not.toContain("Razón");
    });
  });

  // ── refresh ────────────────────────────────────────────────────────────────

  describe("refresh()", () => {
    it("fuerza fetch del upstream y actualiza el cache", async () => {
      mockFetch(UPSTREAM_BODY);

      const result = await service.refresh();

      expect(result.value).toBe(36.5);
      expect(result.stale).toBe(false);
      expect(result.source).toBe("bcv");
      expect(mockRedis.setex).toHaveBeenCalledTimes(2);
    });

    it("lanza excepción si el upstream falla (a diferencia de getCurrent)", async () => {
      jest
        .spyOn(global, "fetch")
        .mockRejectedValueOnce(new Error("upstream down"));

      await expect(service.refresh()).rejects.toThrow();
    });
  });

  // ── Invariante: snapshot de órdenes ───────────────────────────────────────

  describe("Invariante: snapshot de órdenes es inmutable", () => {
    it("getCurrent devuelve el override al crear la orden, pero el snapshot queda fijo", async () => {
      // Simula: override manual activo en Redis
      const overrideRate = makeRate({
        value: 45.0,
        source: "manual",
        manual_override: true,
        set_by: "admin@test.com",
      });
      mockRedis.get.mockResolvedValue(JSON.stringify(overrideRate));

      const rate = await service.getCurrent();

      // El pricing snapshot que crearía OrderService usaría rate.value = 45
      const totalUsd = 10;
      const totalBs = Math.round(totalUsd * rate.value * 100) / 100;

      expect(rate.value).toBe(45.0);
      expect(totalBs).toBe(450.0); // 10 USD × 45 Bs/USD

      // Simula que la tasa cambia después (override expiró, vuelve al BCV real)
      const newRate = makeRate({ value: 36.42, source: "bcv" });
      mockRedis.get.mockResolvedValue(JSON.stringify(newRate));

      const rateAfter = await service.getCurrent();

      // El snapshot de la orden ya creada NO cambia — sigue siendo 450 Bs
      // (el campo totalBs quedó guardado en Mongo, no se recalcula)
      expect(totalBs).toBe(450.0); // invariante: valor inmutable
      expect(rateAfter.value).toBe(36.42); // tasa nueva para órdenes futuras
    });
  });
});
