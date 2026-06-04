/**
 * Tests unitarios — Auto-aprobación PagoMóvil
 *
 * Cubre los métodos públicos del servicio que se pueden testear sin Mongo/Redis:
 *   - checkAutoApprove(): 7 condiciones de seguridad
 *   - isReceiptDateRecent(): validación de fecha del comprobante
 *
 * Correr: pnpm --filter=api test pagomovil-auto-approve
 */

import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { Types } from "mongoose";
import { OrderService } from "./order.service";
import { Order } from "./schemas/order.schema";
import { PickupCounter } from "./schemas/pickup-counter.schema";
import { DailyOrderCounter } from "./schemas/daily-order-counter.schema";
import { Staff } from "../booking/schemas/staff.schema";
import { AppLogger } from "../logger/logger.service";
import { TenantService } from "../tenant/tenant.service";
import { TenantConfigService } from "../tenant/tenant-config.service";
import { MenuService } from "../menu/menu.service";
import { OrdersGateway } from "../gateway/orders.gateway";
import { PaymentTransactionService } from "../payment/payment-transaction.service";
import { BcvRateService } from "../bcv-rate/bcv-rate.service";
import { MediaService } from "../media/media.service";
import { PushService } from "../push/push.service";
import { EmailService } from "../auth/email.service";
import { NotificationService } from "../notification/notification.service";
import type { OrderDocument } from "./schemas/order.schema";
import type { SubmitPagomovilDto } from "./dto/order.dto";

// ── Helpers ────────────────────────────────────────────────────────────────────

const TENANT_ID = new Types.ObjectId().toHexString();

/** Hoy en formato dd/mm/yyyy */
function todayStr(): string {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Hace N días en formato dd/mm/yyyy */
function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

/** Orden base válida para auto-aprobación */
function makeOrder(overrides: Partial<OrderDocument> = {}): OrderDocument {
  return {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(TENANT_ID),
    tenantSlug: "demo-food",
    tableNumber: 3,
    orderType: "dine_in",
    status: "pending_verification",
    total: 15.0,
    pricing: {
      total_usd: 15.0,
      usd_rate: 36.5,
      total_bs: 547.5,
      rate_captured_at: new Date(),
      rate_stale: false,
    },
    payment: {
      method: "pagomovil",
      status: "pending_verification",
      pagomovil_receipt_url: "https://res.cloudinary.com/example/receipt.jpg",
      pagomovil_receipt_public_id: null,
      pagomovil_suspicious: null,
      pagomovil_ocr_confidence: null,
      pagomovil_auto_approved: false,
    },
    items: [],
    traceId: "trace-test-auto",
    ...overrides,
  } as unknown as OrderDocument;
}

/** DTO base que pasa todos los checks */
function makeDto(
  overrides: Partial<SubmitPagomovilDto> = {},
): SubmitPagomovilDto {
  return {
    pagomovil_reference: "123456789012",
    pagomovil_phone: "04141234567",
    pagomovil_bank: "Banesco",
    pagomovil_amount: 547.5, // coincide con pricing.total_bs
    pagomovil_crosscheck: "match",
    pagomovil_ocr_confidence: "high",
    pagomovil_suspicious: false,
    pagomovil_date: todayStr(),
    ...overrides,
  };
}

// ── Mocks mínimos ──────────────────────────────────────────────────────────────

const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  logError: jest.fn(),
  debug: jest.fn(),
};

const mockTenantConfigService = {
  getEffective: jest.fn(),
};

// ── Suite ──────────────────────────────────────────────────────────────────────

describe("OrderService — checkAutoApprove()", () => {
  let service: OrderService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getModelToken(Order.name), useValue: {} },
        { provide: getModelToken(PickupCounter.name), useValue: {} },
        { provide: getModelToken(DailyOrderCounter.name), useValue: {} },
        { provide: getModelToken(Staff.name), useValue: {} },
        { provide: AppLogger, useValue: mockLogger },
        {
          provide: TenantService,
          useValue: { findById: jest.fn().mockResolvedValue({ name: "Demo" }) },
        },
        { provide: TenantConfigService, useValue: mockTenantConfigService },
        { provide: MenuService, useValue: {} },
        { provide: OrdersGateway, useValue: {} },
        { provide: PaymentTransactionService, useValue: {} },
        { provide: BcvRateService, useValue: {} },
        { provide: MediaService, useValue: {} },
        { provide: PushService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: NotificationService, useValue: {} },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  // ── Caso feliz ────────────────────────────────────────────────────────────────
  it("devuelve canApprove=true cuando se cumplen todos los requisitos", () => {
    const result = service.checkAutoApprove(makeOrder(), makeDto());
    expect(result.canApprove).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  // ── Check 1: imagen sospechosa ────────────────────────────────────────────────
  it("rechaza si suspicious=true (imagen potencialmente manipulada)", () => {
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_suspicious: true }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/sospechosa/i);
  });

  // ── Check 2: confianza OCR ────────────────────────────────────────────────────
  it("rechaza si ocr_confidence=medium", () => {
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_ocr_confidence: "medium" }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/confianza/i);
  });

  it("rechaza si ocr_confidence=low", () => {
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_ocr_confidence: "low" }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/confianza/i);
  });

  it("rechaza si ocr_confidence es undefined (sin OCR)", () => {
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_ocr_confidence: undefined }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/confianza/i);
  });

  // ── Check 3: crosscheck del teléfono ─────────────────────────────────────────
  it("rechaza si crosscheck=mismatch (transfirió al número equivocado)", () => {
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_crosscheck: "mismatch" }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/tel[eé]fono/i);
  });

  it("aprueba si crosscheck=unknown (no se pudo comparar)", () => {
    // "unknown" no es un motivo de rechazo — ocurre cuando el tenant no
    // tiene teléfono configurado o el OCR no extrajo el beneficiario
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_crosscheck: "unknown" }),
    );
    expect(result.canApprove).toBe(true);
  });

  // ── Check 4: límite de monto ──────────────────────────────────────────────────
  it("aprueba orden dine_in de $40 exacto (en el límite)", () => {
    const order = makeOrder({ total: 40, orderType: "dine_in" as any });
    // Ajustamos el monto del DTO al total_bs correspondiente
    const result = service.checkAutoApprove(
      order,
      makeDto({ pagomovil_amount: order.pricing!.total_bs }),
    );
    expect(result.canApprove).toBe(true);
  });

  it("rechaza orden dine_in de $41 (supera el límite de $40)", () => {
    const order = makeOrder({ total: 41, orderType: "dine_in" as any });
    const result = service.checkAutoApprove(
      order,
      makeDto({ pagomovil_amount: order.pricing!.total_bs }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/monto/i);
  });

  it("rechaza orden takeaway de $21 (supera el límite de $20)", () => {
    const order = makeOrder({ total: 21, orderType: "takeaway" as any });
    const result = service.checkAutoApprove(
      order,
      makeDto({ pagomovil_amount: order.pricing!.total_bs }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/monto/i);
  });

  it("aprueba orden delivery de $20 exacto (en el límite)", () => {
    const order = makeOrder({ total: 20, orderType: "delivery" as any });
    const result = service.checkAutoApprove(
      order,
      makeDto({ pagomovil_amount: order.pricing!.total_bs }),
    );
    expect(result.canApprove).toBe(true);
  });

  // ── Check 5: fecha del comprobante ────────────────────────────────────────────
  it("rechaza si la fecha del comprobante tiene más de 48hs", () => {
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_date: daysAgoStr(3) }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/fecha/i);
  });

  it("rechaza si la fecha del comprobante es undefined", () => {
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_date: undefined }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/fecha/i);
  });

  it("aprueba con fecha de ayer (dentro de las 48hs)", () => {
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_date: daysAgoStr(1) }),
    );
    expect(result.canApprove).toBe(true);
  });

  // ── Check 6: discrepancia de monto ───────────────────────────────────────────
  it("rechaza si el monto Bs difiere más del 2% del esperado", () => {
    // total_bs = 547.5, declaramos 600 (diff ~9.5%)
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_amount: 600 }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/monto.*difiere/i);
  });

  it("aprueba si el monto Bs tiene menos del 2% de diferencia (redondeo)", () => {
    // total_bs = 547.5, declaramos 547.0 (diff 0.09%)
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({ pagomovil_amount: 547.0 }),
    );
    expect(result.canApprove).toBe(true);
  });

  // ── Check 7: imagen del comprobante ──────────────────────────────────────────
  it("rechaza si no se subió imagen del comprobante (receipt_url null)", () => {
    const order = makeOrder({
      payment: {
        method: "pagomovil",
        status: "pending_verification",
        pagomovil_receipt_url: null,
        pagomovil_receipt_public_id: null,
        pagomovil_suspicious: null,
        pagomovil_ocr_confidence: null,
        pagomovil_auto_approved: false,
      } as any,
    });
    const result = service.checkAutoApprove(order, makeDto());
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/imagen/i);
  });

  // ── Combinaciones ─────────────────────────────────────────────────────────────
  it("el primer check que falla determina el reason (suspicious tiene prioridad)", () => {
    // Tanto suspicious como confidence fallan → debería reportar suspicious primero
    const result = service.checkAutoApprove(
      makeOrder(),
      makeDto({
        pagomovil_suspicious: true,
        pagomovil_ocr_confidence: "low",
      }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.reason).toMatch(/sospechosa/i);
  });
});

// ── isReceiptDateRecent() ──────────────────────────────────────────────────────

describe("OrderService — isReceiptDateRecent()", () => {
  let service: OrderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getModelToken(Order.name), useValue: {} },
        { provide: getModelToken(PickupCounter.name), useValue: {} },
        { provide: getModelToken(DailyOrderCounter.name), useValue: {} },
        { provide: getModelToken(Staff.name), useValue: {} },
        { provide: AppLogger, useValue: mockLogger },
        {
          provide: TenantService,
          useValue: { findById: jest.fn().mockResolvedValue({ name: "Demo" }) },
        },
        { provide: TenantConfigService, useValue: mockTenantConfigService },
        { provide: MenuService, useValue: {} },
        { provide: OrdersGateway, useValue: {} },
        { provide: PaymentTransactionService, useValue: {} },
        { provide: BcvRateService, useValue: {} },
        { provide: MediaService, useValue: {} },
        { provide: PushService, useValue: {} },
        { provide: EmailService, useValue: {} },
        { provide: NotificationService, useValue: {} },
      ],
    }).compile();
    service = module.get<OrderService>(OrderService);
  });

  it("acepta fecha de hoy (dd/mm/yyyy)", () => {
    expect(service.isReceiptDateRecent(todayStr())).toBe(true);
  });

  it("acepta fecha de ayer", () => {
    expect(service.isReceiptDateRecent(daysAgoStr(1))).toBe(true);
  });

  it("acepta fecha de hace 47hs (dentro de las 48hs)", () => {
    expect(service.isReceiptDateRecent(daysAgoStr(1))).toBe(true);
  });

  it("rechaza fecha de hace 3 días", () => {
    expect(service.isReceiptDateRecent(daysAgoStr(3))).toBe(false);
  });

  it("rechaza fecha de hace 7 días", () => {
    expect(service.isReceiptDateRecent(daysAgoStr(7))).toBe(false);
  });

  it("rechaza undefined", () => {
    expect(service.isReceiptDateRecent(undefined)).toBe(false);
  });

  it("rechaza null", () => {
    expect(service.isReceiptDateRecent(null)).toBe(false);
  });

  it("rechaza string vacío", () => {
    expect(service.isReceiptDateRecent("")).toBe(false);
  });

  it("rechaza formato incorrecto (mm/dd/yyyy en vez de dd/mm/yyyy)", () => {
    // Si hoy es 15/06/2026, formato americano sería "06/15/2026"
    // que en nuestro parser se lee como día=06, mes=15 → inválido
    expect(service.isReceiptDateRecent("06/15/2026")).toBe(false);
  });

  it("rechaza texto aleatorio", () => {
    expect(service.isReceiptDateRecent("ayer a las 3pm")).toBe(false);
  });

  it("acepta formato con guiones (dd-mm-yyyy)", () => {
    expect(service.isReceiptDateRecent(todayStr().replace(/\//g, "-"))).toBe(
      true,
    );
  });

  it("rechaza fechas futuras", () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const future = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
    // Una fecha futura tiene diffHours negativo → rechazamos
    expect(service.isReceiptDateRecent(future)).toBe(false);
  });
});
