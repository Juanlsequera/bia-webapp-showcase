/**
 * Test unitario — Máquina de estados de comandas
 *
 * Valida la lógica de transición de estados a través del método público updateStatus.
 * Sin Mongo real, sin Redis, sin Socket.io — todo mockeado.
 *
 * Correr: pnpm --filter=api test order-state-machine
 */

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import { getModelToken } from "@nestjs/mongoose";
import { Types } from "mongoose";
import { OrderService } from "./order.service";
import { Order } from "./schemas/order.schema";
import { PickupCounter } from "./schemas/pickup-counter.schema";
import { DailyOrderCounter } from "./schemas/daily-order-counter.schema";
import { AppLogger } from "../logger/logger.service";
import { TenantService } from "../tenant/tenant.service";
import { MenuService } from "../menu/menu.service";
import { OrdersGateway } from "../gateway/orders.gateway";
import { PaymentTransactionService } from "../payment/payment-transaction.service";
import { BcvRateService } from "../bcv-rate/bcv-rate.service";
import { MediaService } from "../media/media.service";
import { PushService } from "../push/push.service";
import { EmailService } from "../auth/email.service";
import { NotificationService } from "../notification/notification.service";
import { Staff } from "../booking/schemas/staff.schema";

// ── Fixture de comanda ────────────────────────────────────────────────────────

// El service valida con `Types.ObjectId.isValid()` antes de pegarle a Mongo,
// por lo que los IDs del fixture tienen que ser ObjectIds válidos (24 hex).
const FIXTURE_ORDER_ID = new Types.ObjectId().toHexString();
const FIXTURE_TENANT_ID = new Types.ObjectId().toHexString();
const OTHER_TENANT_ID = new Types.ObjectId().toHexString();

function makeOrder(status: string) {
  return {
    _id: FIXTURE_ORDER_ID,
    tenantId: FIXTURE_TENANT_ID,
    tenantSlug: "test-slug",
    tableNumber: 1,
    status,
    total: 8.5,
    pricing: {
      total_usd: 8.5,
      usd_rate: 36.5,
      total_bs: 310.25,
      rate_captured_at: new Date(),
      rate_stale: false,
    },
    payment: { method: "pagomovil", status: "approved" },
    items: [],
    traceId: "trace-unit-test",
    customer_phone: null,
  };
}

// ── Mock del modelo Mongoose ──────────────────────────────────────────────────
// El orden es findById → .lean() → .exec() para lectura
// Y findByIdAndUpdate → .lean() → .exec() para escritura.

const mockOrderModel = {
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
};

// ── Mocks de servicios externos ───────────────────────────────────────────────

const mockLogger = {
  log: jest.fn(),
  warn: jest.fn(),
  logError: jest.fn(),
};

const mockGateway = {
  emitToTable: jest.fn(),
  emitToKitchen: jest.fn(),
  emitToAdmin: jest.fn(),
};

const mockPush = {
  notifyOrder: jest.fn().mockResolvedValue(undefined),
};

const mockNotification = {
  notifyOrderReady: jest.fn().mockResolvedValue(undefined),
};

// ── Suite principal ───────────────────────────────────────────────────────────

describe("OrderService — máquina de estados", () => {
  let service: OrderService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getModelToken(Order.name), useValue: mockOrderModel },
        { provide: getModelToken(PickupCounter.name), useValue: {} },
        { provide: getModelToken(DailyOrderCounter.name), useValue: {} },
        { provide: getModelToken(Staff.name), useValue: {} },
        { provide: AppLogger, useValue: mockLogger },
        {
          provide: TenantService,
          useValue: {
            findById: jest.fn().mockResolvedValue({ name: "Test Negocio" }),
          },
        },
        { provide: MenuService, useValue: {} },
        { provide: OrdersGateway, useValue: mockGateway },
        { provide: PaymentTransactionService, useValue: {} },
        { provide: BcvRateService, useValue: {} },
        { provide: MediaService, useValue: {} },
        { provide: PushService, useValue: mockPush },
        { provide: EmailService, useValue: {} },
        { provide: NotificationService, useValue: mockNotification },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  afterEach(() => jest.clearAllMocks());

  // ── Transiciones válidas ──────────────────────────────────────────────────

  const validTransitions: [string, string][] = [
    ["paid", "preparing"],
    ["paid", "cancelled"],
    ["preparing", "ready"],
    ["preparing", "cancelled"],
    ["ready", "delivered"],
  ];

  test.each(validTransitions)("✅ permite %s → %s", async (from, to) => {
    const fakeOrder = makeOrder(from);

    mockOrderModel.findById.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(fakeOrder) }),
    });
    mockOrderModel.findByIdAndUpdate.mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve({ ...fakeOrder, status: to, traceId: null }),
      }),
    });

    await expect(
      service.updateStatus(
        FIXTURE_ORDER_ID,
        FIXTURE_TENANT_ID,
        "operator@test.com",
        { status: to as never },
        "trace-test",
      ),
    ).resolves.toBeDefined();
  });

  // ── Transiciones inválidas ────────────────────────────────────────────────

  const invalidTransitions: [string, string][] = [
    ["paid", "delivered"], // skip — no puede saltar a delivered sin pasar por preparación
    ["paid", "ready"], // skip — igual
    ["preparing", "delivered"], // skip — falta pasar por ready
    ["preparing", "paid"], // regresión
    ["ready", "preparing"], // regresión
    ["ready", "cancelled"], // terminal — ready no puede cancelarse (política de negocio)
    ["delivered", "preparing"], // estado terminal
    ["delivered", "cancelled"], // estado terminal
    ["cancelled", "paid"], // estado terminal
    ["cancelled", "preparing"], // estado terminal
  ];

  test.each(invalidTransitions)(
    "🚫 rechaza %s → %s con BadRequestException",
    async (from, to) => {
      const fakeOrder = makeOrder(from);

      mockOrderModel.findById.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(fakeOrder) }),
      });

      await expect(
        service.updateStatus(
          FIXTURE_ORDER_ID,
          FIXTURE_TENANT_ID,
          "operator@test.com",
          { status: to as never },
          "trace-test",
        ),
      ).rejects.toThrow(BadRequestException);

      // Nunca debería intentar la escritura en una transición inválida
      expect(mockOrderModel.findByIdAndUpdate).not.toHaveBeenCalled();
    },
  );

  // ── Guard de tenant ───────────────────────────────────────────────────────

  it("🔒 rechaza con ForbiddenException si la comanda pertenece a otro tenant", async () => {
    const fakeOrder = makeOrder("paid");

    mockOrderModel.findById.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(fakeOrder) }),
    });

    await expect(
      service.updateStatus(
        FIXTURE_ORDER_ID,
        OTHER_TENANT_ID,
        "operator@test.com",
        { status: "preparing" as never },
        "trace-test",
      ),
    ).rejects.toThrow(ForbiddenException);

    expect(mockOrderModel.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  // ── Push notification al llegar a "ready" ────────────────────────────────

  it('📲 dispara push notification cuando el status pasa a "ready"', async () => {
    const fakeOrder = makeOrder("preparing");

    mockOrderModel.findById.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(fakeOrder) }),
    });
    mockOrderModel.findByIdAndUpdate.mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve({
            ...fakeOrder,
            status: "ready",
            tenantSlug: "test-slug",
            traceId: null,
          }),
      }),
    });

    await service.updateStatus(
      FIXTURE_ORDER_ID,
      FIXTURE_TENANT_ID,
      "operator@test.com",
      { status: "ready" as never },
      "trace-test",
    );

    expect(mockPush.notifyOrder).toHaveBeenCalledWith(
      FIXTURE_ORDER_ID,
      expect.objectContaining({ title: "¡Tu pedido está listo! 🍔" }),
    );
  });

  // ── Eventos WebSocket en transición válida ────────────────────────────────

  it("📡 emite eventos a mesa y cocina en cada transición válida", async () => {
    const fakeOrder = makeOrder("paid");

    mockOrderModel.findById.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(fakeOrder) }),
    });
    mockOrderModel.findByIdAndUpdate.mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve({ ...fakeOrder, status: "preparing", traceId: null }),
      }),
    });

    await service.updateStatus(
      FIXTURE_ORDER_ID,
      FIXTURE_TENANT_ID,
      "operator@test.com",
      { status: "preparing" as never },
      "trace-test",
    );

    expect(mockGateway.emitToTable).toHaveBeenCalledTimes(1);
    expect(mockGateway.emitToKitchen).toHaveBeenCalledTimes(1);
  });
});
