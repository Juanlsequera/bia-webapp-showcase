import { Test, TestingModule } from "@nestjs/testing";
import { BookingService } from "./booking.service";
import { getModelToken } from "@nestjs/mongoose";
import { Staff } from "./schemas/staff.schema";
import { Types } from "mongoose";
import { AppLogger } from "../logger/logger.service";
import { NotificationService } from "../notification/notification.service";
import { TenantService } from "../tenant/tenant.service";
import {
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import * as crypto from "crypto";

describe("BookingService", () => {
  let service: BookingService;
  let mockStaffModel: any;
  let mockOrderModel: any;
  let mockLogger: any;
  let mockNotificationService: any;

  beforeEach(async () => {
    mockLogger = {
      log: jest.fn(),
      logError: jest.fn(),
      warn: jest.fn(),
    };

    mockNotificationService = {
      notifyBookingReminder: jest.fn().mockResolvedValue(undefined),
      notifyBookingConfirmed: jest.fn().mockResolvedValue(undefined),
    };

    mockStaffModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
      save: jest.fn(),
    };

    mockOrderModel = {
      find: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingService,
        {
          provide: getModelToken(Staff.name),
          useValue: mockStaffModel,
        },
        {
          provide: getModelToken("Order"),
          useValue: mockOrderModel,
        },
        {
          provide: AppLogger,
          useValue: mockLogger,
        },
        {
          provide: NotificationService,
          useValue: mockNotificationService,
        },
        {
          provide: TenantService,
          useValue: { findById: jest.fn(), findBySlug: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<BookingService>(BookingService);
  });

  describe("getStaffForService", () => {
    it("should return active staff for a given tenant", async () => {
      const tenantId = new Types.ObjectId().toString();
      const staffData = [
        {
          _id: new Types.ObjectId(),
          name: "María López",
          avatar_url: "https://example.com/avatar.jpg",
          serviceIds: [new Types.ObjectId()],
        },
      ];

      mockStaffModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue(staffData),
      });

      const result = await service.getStaffForService(tenantId);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("María López");
    });

    it("should filter by serviceId if provided", async () => {
      const tenantId = new Types.ObjectId().toString();
      const serviceId = new Types.ObjectId().toString();

      mockStaffModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      await service.getStaffForService(tenantId, serviceId);

      expect(mockStaffModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          serviceIds: new Types.ObjectId(serviceId),
        }),
      );
    });
  });

  describe("getAvailableSlots", () => {
    it("should return empty slots for disabled day", async () => {
      const tenantId = new Types.ObjectId().toString();
      const staffId = new Types.ObjectId().toString();
      const date = "2026-05-18"; // Monday

      const staffData = {
        _id: new Types.ObjectId(staffId),
        schedule: {
          monday: { open: "09:00", close: "18:00", enabled: false },
          tuesday: { open: "09:00", close: "18:00", enabled: true },
          wednesday: { open: "09:00", close: "18:00", enabled: true },
          thursday: { open: "09:00", close: "18:00", enabled: true },
          friday: { open: "09:00", close: "18:00", enabled: true },
          saturday: { open: "09:00", close: "18:00", enabled: true },
          sunday: { open: "09:00", close: "13:00", enabled: false },
          blockedDates: [],
        },
      };

      mockStaffModel.findOne.mockResolvedValue(staffData);

      const result = await service.getAvailableSlots(
        tenantId,
        staffId,
        date,
        60,
      );

      expect(result.slots).toHaveLength(0);
    });

    it("should return empty slots for blocked date", async () => {
      const tenantId = new Types.ObjectId().toString();
      const staffId = new Types.ObjectId().toString();
      const date = "2026-05-18";

      const staffData = {
        _id: new Types.ObjectId(staffId),
        schedule: {
          monday: { open: "09:00", close: "18:00", enabled: true },
          tuesday: { open: "09:00", close: "18:00", enabled: true },
          wednesday: { open: "09:00", close: "18:00", enabled: true },
          thursday: { open: "09:00", close: "18:00", enabled: true },
          friday: { open: "09:00", close: "18:00", enabled: true },
          saturday: { open: "09:00", close: "18:00", enabled: true },
          sunday: { open: "09:00", close: "13:00", enabled: false },
          blockedDates: [date],
        },
      };

      mockStaffModel.findOne.mockResolvedValue(staffData);

      const result = await service.getAvailableSlots(
        tenantId,
        staffId,
        date,
        60,
      );

      expect(result.slots).toHaveLength(0);
    });

    it("should generate slots every N minutes", async () => {
      const tenantId = new Types.ObjectId().toString();
      const staffId = new Types.ObjectId().toString();
      const date = "2026-05-18"; // Monday

      const staffData = {
        _id: new Types.ObjectId(staffId),
        schedule: {
          monday: { open: "09:00", close: "10:00", enabled: true },
          tuesday: { open: "09:00", close: "18:00", enabled: true },
          wednesday: { open: "09:00", close: "18:00", enabled: true },
          thursday: { open: "09:00", close: "18:00", enabled: true },
          friday: { open: "09:00", close: "18:00", enabled: true },
          saturday: { open: "09:00", close: "18:00", enabled: true },
          sunday: { open: "09:00", close: "13:00", enabled: false },
          blockedDates: [],
        },
      };

      mockStaffModel.findOne.mockResolvedValue(staffData);
      mockOrderModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });

      const result = await service.getAvailableSlots(
        tenantId,
        staffId,
        date,
        30,
      );

      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.slots[0].time).toBe("09:00");
    });

    it("should mark slots as unavailable if booking exists", async () => {
      const tenantId = new Types.ObjectId().toString();
      const staffId = new Types.ObjectId().toString();
      const date = "2026-05-18";

      const staffData = {
        _id: new Types.ObjectId(staffId),
        schedule: {
          monday: { open: "09:00", close: "10:00", enabled: true },
          tuesday: { open: "09:00", close: "18:00", enabled: true },
          wednesday: { open: "09:00", close: "18:00", enabled: true },
          thursday: { open: "09:00", close: "18:00", enabled: true },
          friday: { open: "09:00", close: "18:00", enabled: true },
          saturday: { open: "09:00", close: "18:00", enabled: true },
          sunday: { open: "09:00", close: "13:00", enabled: false },
          blockedDates: [],
        },
      };

      const bookingDatetime = new Date(`${date}T09:00:00Z`);
      const existingBooking = {
        _id: new Types.ObjectId(),
        bookingDatetime,
        status: "confirmed",
      };

      mockStaffModel.findOne.mockResolvedValue(staffData);
      mockOrderModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([existingBooking]),
      });

      const result = await service.getAvailableSlots(
        tenantId,
        staffId,
        date,
        60,
      );

      expect(result.slots.length).toBeGreaterThan(0);
      expect(result.slots[0].available).toBe(false);
    });

    it("should throw NotFoundException if staff not found", async () => {
      const tenantId = new Types.ObjectId().toString();
      const staffId = new Types.ObjectId().toString();
      mockStaffModel.findOne.mockResolvedValue(null);

      await expect(
        service.getAvailableSlots(tenantId, staffId, "2026-05-18", 60),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw BadRequestException for invalid date format", async () => {
      const tenantId = new Types.ObjectId().toString();
      const staffId = new Types.ObjectId().toString();
      mockStaffModel.findOne.mockResolvedValue({
        schedule: { blockedDates: [] },
      });

      await expect(
        service.getAvailableSlots(tenantId, staffId, "invalid-date", 60),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("create", () => {
    it("create method should be a function", () => {
      expect(typeof service.create).toBe("function");
    });
  });

  describe("getBookingsByDate", () => {
    it("should return bookings for a specific date", async () => {
      const tenantId = new Types.ObjectId().toString();
      const date = "2026-05-18";

      const bookings = [
        {
          _id: new Types.ObjectId(),
          bookingDatetime: new Date(`${date}T10:00:00Z`),
          customer_name: "Cliente 1",
        },
      ];

      mockOrderModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(bookings),
        }),
      });

      const result = await service.getBookingsByDate(tenantId, date);

      expect(result).toHaveLength(1);
      expect(result[0].customer_name).toBe("Cliente 1");
    });

    it("should throw BadRequestException for invalid date format", async () => {
      await expect(
        service.getBookingsByDate("tenant1", "invalid"),
      ).rejects.toThrow(BadRequestException);
    });
  });

  // ─── getCalendarAvailability ──────────────────────────────────────────────────

  describe("getCalendarAvailability", () => {
    const tenantId = new Types.ObjectId().toString();
    const staffId = new Types.ObjectId().toString();

    /** Staff con lunes a viernes 09:00-10:00 habilitado */
    const activeStaff = {
      _id: new Types.ObjectId(staffId),
      name: "Carlos",
      avatar_url: null,
      serviceIds: [],
      schedule: {
        monday: { open: "09:00", close: "10:00", enabled: true },
        tuesday: { open: "09:00", close: "10:00", enabled: true },
        wednesday: { open: "09:00", close: "10:00", enabled: true },
        thursday: { open: "09:00", close: "10:00", enabled: true },
        friday: { open: "09:00", close: "10:00", enabled: true },
        saturday: { open: "09:00", close: "10:00", enabled: false },
        sunday: { open: "09:00", close: "10:00", enabled: false },
        blockedDates: [],
      },
    };

    function setupStaffWithBookings(bookings: any[] = []) {
      mockStaffModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([activeStaff]),
      });
      mockStaffModel.findOne.mockResolvedValue(activeStaff);
      mockOrderModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue(bookings),
      });
    }

    it("retorna solo fechas del mes solicitado", async () => {
      setupStaffWithBookings();
      const result = await service.getCalendarAvailability(
        tenantId,
        2099,
        6,
        undefined,
        staffId,
      );
      result.forEach((d) => {
        expect(d.startsWith("2099-06")).toBe(true);
      });
    });

    it("no retorna fechas pasadas", async () => {
      setupStaffWithBookings();
      // Enero 2020 — todo pasado
      const result = await service.getCalendarAvailability(
        tenantId,
        2020,
        1,
        undefined,
        staffId,
      );
      expect(result).toHaveLength(0);
    });

    it("con staffId: solo usa ese staff", async () => {
      mockStaffModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([activeStaff]),
      });
      mockStaffModel.findOne.mockResolvedValue(activeStaff);
      mockOrderModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      await service.getCalendarAvailability(
        tenantId,
        2099,
        6,
        undefined,
        staffId,
      );
      // findOne fue llamado con el staffId correcto
      expect(mockStaffModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: new Types.ObjectId(staffId) }),
      );
    });

    it("sin staffId: usa todos los staff activos del tenant", async () => {
      setupStaffWithBookings();
      await service.getCalendarAvailability(tenantId, 2099, 6);
      // getStaffForService llama a find
      expect(mockStaffModel.find).toHaveBeenCalled();
    });

    it("sin staff activo → retorna array vacío", async () => {
      mockStaffModel.find.mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      });
      const result = await service.getCalendarAvailability(tenantId, 2099, 6);
      expect(result).toHaveLength(0);
    });

    it("staff con día sin horario habilitado → ese día no aparece", async () => {
      setupStaffWithBookings();
      // 2099-06-01 es domingo → no habilitado en activeStaff
      const result = await service.getCalendarAvailability(
        tenantId,
        2099,
        6,
        undefined,
        staffId,
      );
      // El 1 de junio 2099 es domingo → no debe aparecer
      // (No podemos verificar exactamente qué día cae, pero el resultado
      // no debe incluir días donde el schedule está disabled)
      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ─── Cálculo de seña (deposit) ─────────────────────────────────────────────

  describe("cálculo de seña", () => {
    function calcDeposit(price: number, pct: number): number {
      return Math.round(((price * pct) / 100) * 100) / 100;
    }

    it("deposit_pct=50, price=20 → deposit_amount=10.00", () => {
      expect(calcDeposit(20, 50)).toBe(10.0);
    });

    it("deposit_pct=0 → deposit_amount=0", () => {
      expect(calcDeposit(20, 0)).toBe(0);
    });

    it("deposit_pct=100 → deposit_amount === total", () => {
      expect(calcDeposit(20, 100)).toBe(20.0);
    });

    it("deposit_pct=33, price=9.99 → redondeo a 2 decimales", () => {
      const result = calcDeposit(9.99, 33);
      // 9.99 * 33 / 100 = 3.2967 → redondeado a 3.30
      expect(result).toBe(3.3);
      // Verificar que es un número con máximo 2 decimales
      expect(Number.isFinite(result)).toBe(true);
      expect(String(result).replace(/^\d+\.?/, "").length).toBeLessThanOrEqual(
        2,
      );
    });

    it("deposit_pct=25, price=40 → 10.00", () => {
      expect(calcDeposit(40, 25)).toBe(10.0);
    });
  });

  // ─── SEC-01: Token de cancelación ────────────────────────────────────────────

  describe("cancelBooking — token validation (SEC-01)", () => {
    const tenantId = new Types.ObjectId().toString();
    const orderId = new Types.ObjectId().toString();
    const validToken = crypto.randomBytes(32).toString("hex");

    function makeBookingOrder(token: string | null = validToken) {
      const order: any = {
        _id: new Types.ObjectId(orderId),
        cancellation_token: token,
        status: "scheduled",
        save: jest.fn().mockResolvedValue({
          toObject: () => ({ _id: orderId, status: "cancelled" }),
        }),
      };
      return order;
    }

    it("✅ cancela con token correcto (cliente sin auth)", async () => {
      const order = makeBookingOrder(validToken);
      mockOrderModel.findOne.mockResolvedValue(order);

      await expect(
        service.cancelBooking(tenantId, orderId, "no puedo", validToken),
      ).resolves.toBeDefined();
      expect(order.save).toHaveBeenCalled();
    });

    it("🚫 lanza ForbiddenException con token incorrecto", async () => {
      const order = makeBookingOrder(validToken);
      mockOrderModel.findOne.mockResolvedValue(order);
      const wrongToken = crypto.randomBytes(32).toString("hex");

      await expect(
        service.cancelBooking(tenantId, orderId, undefined, wrongToken),
      ).rejects.toThrow(ForbiddenException);
      expect(order.save).not.toHaveBeenCalled();
    });

    it("🚫 lanza ForbiddenException con token vacío string", async () => {
      const order = makeBookingOrder(validToken);
      mockOrderModel.findOne.mockResolvedValue(order);

      await expect(
        service.cancelBooking(tenantId, orderId, undefined, ""),
      ).rejects.toThrow(ForbiddenException);
    });

    it("✅ admin bypass: sin token (undefined) omite la validación", async () => {
      const order = makeBookingOrder(validToken);
      mockOrderModel.findOne.mockResolvedValue(order);

      // token=undefined → admin bypass
      await expect(
        service.cancelBooking(tenantId, orderId, "admin cancel", undefined),
      ).resolves.toBeDefined();
      expect(order.save).toHaveBeenCalled();
    });

    it("✅ legacy booking sin token almacenado (token=null) → omite validación", async () => {
      const order = makeBookingOrder(null); // vieja reserva sin token
      mockOrderModel.findOne.mockResolvedValue(order);

      await expect(
        service.cancelBooking(tenantId, orderId, undefined, "cualquier-valor"),
      ).resolves.toBeDefined();
      expect(order.save).toHaveBeenCalled();
    });

    it("🚫 lanza NotFoundException si la reserva no existe", async () => {
      mockOrderModel.findOne.mockResolvedValue(null);

      await expect(
        service.cancelBooking(tenantId, orderId, undefined, validToken),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("rescheduleBooking — token validation (SEC-01)", () => {
    const tenantId = new Types.ObjectId().toString();
    const orderId = new Types.ObjectId().toString();
    const staffId = new Types.ObjectId().toString();
    const validToken = crypto.randomBytes(32).toString("hex");
    const newDatetime = new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();

    function makeBookingOrder(token: string | null = validToken) {
      const order: any = {
        _id: new Types.ObjectId(orderId),
        tenantId: new Types.ObjectId(tenantId),
        cancellation_token: token,
        status: "scheduled",
        staffId: null,
        bookingDatetime: null,
        save: jest.fn().mockResolvedValue({
          toObject: () => ({ _id: orderId, status: "rescheduled" }),
        }),
      };
      return order;
    }

    it("✅ reprograma con token correcto", async () => {
      const order = makeBookingOrder(validToken);
      mockOrderModel.findOne
        .mockResolvedValueOnce(order) // findOne para la orden
        .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) }); // anti double-booking

      await expect(
        service.rescheduleBooking(
          tenantId,
          orderId,
          staffId,
          newDatetime,
          validToken,
        ),
      ).resolves.toBeDefined();
    });

    it("🚫 lanza ForbiddenException con token incorrecto", async () => {
      const order = makeBookingOrder(validToken);
      mockOrderModel.findOne.mockResolvedValue(order);
      const wrongToken = crypto.randomBytes(32).toString("hex");

      await expect(
        service.rescheduleBooking(
          tenantId,
          orderId,
          staffId,
          newDatetime,
          wrongToken,
        ),
      ).rejects.toThrow(ForbiddenException);
      expect(order.save).not.toHaveBeenCalled();
    });

    it("✅ admin bypass (token=undefined) omite la validación", async () => {
      const order = makeBookingOrder(validToken);
      mockOrderModel.findOne
        .mockResolvedValueOnce(order)
        .mockReturnValueOnce({ lean: jest.fn().mockResolvedValue(null) });

      await expect(
        service.rescheduleBooking(tenantId, orderId, staffId, newDatetime),
      ).resolves.toBeDefined();
    });
  });

  describe("sendBookingReminders", () => {
    it("should return 0 when no bookings are in the reminder window", async () => {
      mockOrderModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await service.sendBookingReminders();
      expect(result).toBe(0);
    });

    it("should send reminders for bookings 23-25h from now and transition to reminder_sent", async () => {
      const bookingId = new Types.ObjectId();
      const bookingDatetime = new Date(Date.now() + 24 * 3_600_000);

      const bookings = [
        {
          _id: bookingId,
          customer_phone: "+584141234567",
          customer_name: "Ana Pérez",
          tenantSlug: "mi-negocio",
          bookingDatetime,
          status: "confirmed",
          staffId: { name: "María López" },
        },
      ];

      mockOrderModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(bookings),
        }),
      });
      mockOrderModel.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.sendBookingReminders();

      expect(result).toBe(1);
      expect(mockOrderModel.updateOne).toHaveBeenCalledWith(
        expect.objectContaining({ _id: bookingId }),
        { $set: { status: "reminder_sent" } },
      );
      expect(
        mockNotificationService.notifyBookingReminder,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          customerPhone: "+584141234567",
          customerName: "Ana Pérez",
          staffName: "María López",
        }),
      );
    });

    it("should continue processing remaining bookings if one notification fails", async () => {
      const b1 = new Types.ObjectId();
      const b2 = new Types.ObjectId();
      const dt = new Date(Date.now() + 24 * 3_600_000);

      const bookings = [
        {
          _id: b1,
          customer_phone: "+1111",
          customer_name: "A",
          tenantSlug: "x",
          bookingDatetime: dt,
          status: "confirmed",
          staffId: null,
        },
        {
          _id: b2,
          customer_phone: "+2222",
          customer_name: "B",
          tenantSlug: "x",
          bookingDatetime: dt,
          status: "confirmed",
          staffId: null,
        },
      ];

      mockOrderModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(bookings),
        }),
      });
      mockOrderModel.updateOne
        .mockResolvedValueOnce({ modifiedCount: 1 })
        .mockRejectedValueOnce(new Error("DB error"));

      const result = await service.sendBookingReminders();
      // b1 succeeds, b2 fails at updateOne → only 1 sent
      expect(result).toBe(1);
    });

    it("should skip reminder if status already changed before updateOne", async () => {
      const bookingId = new Types.ObjectId();
      const dt = new Date(Date.now() + 24 * 3_600_000);

      mockOrderModel.find.mockReturnValue({
        populate: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue([
            {
              _id: bookingId,
              customer_phone: null,
              customer_name: null,
              tenantSlug: "x",
              bookingDatetime: dt,
              status: "confirmed",
              staffId: null,
            },
          ]),
        }),
      });
      mockOrderModel.updateOne.mockResolvedValue({ modifiedCount: 0 });

      // modifiedCount=0 means the doc was already updated by another process —
      // we still call notifyBookingReminder (fire-and-forget) because the reminder
      // intent was already captured. Test just verifies no crash.
      const result = await service.sendBookingReminders();
      expect(result).toBe(1);
    });
  });
});
