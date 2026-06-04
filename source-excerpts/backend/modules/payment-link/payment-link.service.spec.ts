import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { Types } from "mongoose";
import { PaymentLinkService } from "./payment-link.service";

// ── helpers ────────────────────────────────────────────────────────────────────

function oid() {
  return new Types.ObjectId().toHexString();
}

/** Builds a minimal PaymentLink document mock. Fields default to a fresh active link. */
function makeLink(overrides: Record<string, unknown> = {}) {
  const doc: Record<string, unknown> = {
    _id: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    tenantSlug: "demo-negocio",
    description: "Servicio técnico",
    amount: 50,
    status: "active",
    paymentMethod: "pagomovil",
    paymentAccountId: null,
    paymentAccountSnapshot: null,
    expiresAt: null,
    paidAt: null,
    paidWith: null,
    pagomovil_reference: null,
    pagomovil_phone: null,
    pagomovil_bank: null,
    pagomovil_amount_bs: null,
    pagomovil_receipt_url: null,
    pagomovil_submitted_at: null,
    transfer_receipt_url: null,
    transfer_reference: null,
    zelle_receipt_url: null,
    zelle_amount: null,
    createdAt: new Date(),
    ...overrides,
    save: jest.fn().mockImplementation(function (
      this: Record<string, unknown>,
    ) {
      return Promise.resolve(this);
    }),
  };
  return doc;
}

/** Creates a mock Mongoose model with chainable methods. */
function makeModel() {
  const model: Record<string, jest.Mock> = {
    create: jest.fn(),
    findById: jest.fn(),
    find: jest.fn(),
    findByIdAndUpdate: jest.fn(),
  };
  return model;
}

/** Returns a mock tenant with bankAccounts, transferAccounts and zelleAccounts. */
function makeTenant(overrides: Record<string, unknown> = {}) {
  const bankAccount = {
    _id: new Types.ObjectId(),
    bank: "Banesco",
    phone: "04141234567",
    rif: "J-123",
    accountHolder: "Demo CA",
    isDefault: true,
    isActive: true,
  };
  const transferAccount = {
    _id: new Types.ObjectId(),
    subtype: "national",
    currency: "VES",
    accountHolder: "Demo CA",
    alias: null,
    bank: "Mercantil",
    accountNumber: "0105-0001-00-0001234567",
    isDefault: true,
    isActive: true,
  };
  const zelleAccount = {
    _id: new Types.ObjectId(),
    contactType: "email",
    contact: "pagos@demo.com",
    holderName: "Demo CA",
    bankApp: "Zelle",
    alias: null,
    isDefault: true,
    isActive: true,
  };
  return {
    _id: new Types.ObjectId(),
    slug: "demo-negocio",
    bankAccounts: [bankAccount],
    transferAccounts: [transferAccount],
    zelleAccounts: [zelleAccount],
    ...overrides,
  };
}

// ── suite ──────────────────────────────────────────────────────────────────────

describe("PaymentLinkService", () => {
  let service: PaymentLinkService;
  let mockModel: ReturnType<typeof makeModel>;
  let mockTenantService: { findById: jest.Mock };
  let mockMediaService: { uploadImage: jest.Mock };
  let mockLogger: { log: jest.Mock; logError: jest.Mock };

  beforeEach(() => {
    mockModel = makeModel();
    mockTenantService = { findById: jest.fn() };
    mockMediaService = { uploadImage: jest.fn() };
    mockLogger = { log: jest.fn(), logError: jest.fn() };

    service = new PaymentLinkService(
      mockModel as any,
      mockTenantService as any,
      mockMediaService as any,
      mockLogger as any,
    );
  });

  // ── create ───────────────────────────────────────────────────────────────────

  describe("create", () => {
    const user = { _id: oid(), tenantId: oid(), role: "admin" } as any;

    it("crea un link con pagomovil y snapshot de la cuenta default", async () => {
      const tenant = makeTenant();
      mockTenantService.findById.mockResolvedValue(tenant);

      const created = makeLink();
      mockModel.create.mockResolvedValue(created);

      const result = await service.create(String(tenant._id), user, {
        description: "Viaje al aeropuerto",
        amount: 25,
        paymentMethod: "pagomovil",
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethod: "pagomovil",
          paymentAccountSnapshot: expect.objectContaining({
            bank: "Banesco",
            isDefault: true,
          }),
        }),
      );
      expect(result).toBe(created);
    });

    it("usa la cuenta especificada por paymentAccountId si se envía", async () => {
      const tenant = makeTenant();
      const accountId = String(tenant.bankAccounts[0]._id);
      mockTenantService.findById.mockResolvedValue(tenant);
      mockModel.create.mockResolvedValue(makeLink());

      await service.create(String(tenant._id), user, {
        description: "Seña",
        amount: 10,
        paymentMethod: "pagomovil",
        paymentAccountId: accountId,
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ paymentAccountId: accountId }),
      );
    });

    it("crea con paymentMethod=transfer y snapshot de transferAccount", async () => {
      const tenant = makeTenant();
      mockTenantService.findById.mockResolvedValue(tenant);
      mockModel.create.mockResolvedValue(
        makeLink({ paymentMethod: "transfer" }),
      );

      await service.create(String(tenant._id), user, {
        description: "Pago servicio",
        amount: 100,
        paymentMethod: "transfer",
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethod: "transfer",
          paymentAccountSnapshot: expect.objectContaining({
            bank: "Mercantil",
            accountNumber: "0105-0001-00-0001234567",
          }),
        }),
      );
    });

    it("crea con paymentMethod=zelle y snapshot de zelleAccount", async () => {
      const tenant = makeTenant();
      mockTenantService.findById.mockResolvedValue(tenant);
      mockModel.create.mockResolvedValue(makeLink({ paymentMethod: "zelle" }));

      await service.create(String(tenant._id), user, {
        description: "Cobro Zelle",
        amount: 30,
        paymentMethod: "zelle",
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentMethod: "zelle",
          paymentAccountSnapshot: expect.objectContaining({
            contact: "pagos@demo.com",
            holderName: "Demo CA",
          }),
        }),
      );
    });

    it("paymentAccountSnapshot es null si el tenant no tiene cuentas para el método", async () => {
      const tenant = makeTenant({ transferAccounts: [] });
      mockTenantService.findById.mockResolvedValue(tenant);
      mockModel.create.mockResolvedValue(
        makeLink({ paymentMethod: "transfer" }),
      );

      await service.create(String(tenant._id), user, {
        description: "Sin cuenta",
        amount: 5,
        paymentMethod: "transfer",
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ paymentAccountSnapshot: null }),
      );
    });

    it("usa default=true sobre la primera cuenta activa cuando hay múltiples", async () => {
      const nonDefault = {
        _id: new Types.ObjectId(),
        bank: "Provincial",
        phone: "04241234567",
        rif: "V-999",
        accountHolder: "Otro",
        isDefault: false,
        isActive: true,
      };
      const defaultAcc = {
        _id: new Types.ObjectId(),
        bank: "Banesco",
        phone: "04141234567",
        rif: "J-123",
        accountHolder: "Demo CA",
        isDefault: true,
        isActive: true,
      };
      const tenant = makeTenant({ bankAccounts: [nonDefault, defaultAcc] });
      mockTenantService.findById.mockResolvedValue(tenant);
      mockModel.create.mockResolvedValue(makeLink());

      await service.create(String(tenant._id), user, {
        description: "Test",
        amount: 5,
        paymentMethod: "pagomovil",
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentAccountSnapshot: expect.objectContaining({ bank: "Banesco" }),
        }),
      );
    });
  });

  // ── getPublic ─────────────────────────────────────────────────────────────────

  describe("getPublic", () => {
    it("retorna el link cuando existe", async () => {
      const link = makeLink();
      mockModel.findById.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(link) }),
      });

      const result = await service.getPublic(String(link._id));
      expect(result).toBe(link);
    });

    it("lanza NotFoundException con linkId inválido (no es ObjectId)", async () => {
      await expect(service.getPublic("no-valido")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("lanza NotFoundException si el link no existe en la DB", async () => {
      mockModel.findById.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(service.getPublic(oid())).rejects.toThrow(NotFoundException);
    });

    it("actualiza status a expired si expiresAt ya pasó y estaba active", async () => {
      const past = new Date(Date.now() - 1000);
      const link = makeLink({ status: "active", expiresAt: past });
      mockModel.findById.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(link) }),
      });
      mockModel.findByIdAndUpdate.mockResolvedValue({});

      const result = await service.getPublic(String(link._id));

      expect(mockModel.findByIdAndUpdate).toHaveBeenCalledWith(
        String(link._id),
        { status: "expired" },
      );
      expect((result as any).status).toBe("expired");
    });

    it("no actualiza status si expiresAt es futuro", async () => {
      const future = new Date(Date.now() + 3_600_000);
      const link = makeLink({ status: "active", expiresAt: future });
      mockModel.findById.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(link) }),
      });

      await service.getPublic(String(link._id));
      expect(mockModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });
  });

  // ── cancel ───────────────────────────────────────────────────────────────────

  describe("cancel", () => {
    it("cancela un link active del tenant correcto", async () => {
      const tenantId = oid();
      const link = makeLink({ tenantId: new Types.ObjectId(tenantId) });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await service.cancel(String(link._id), tenantId);

      expect(link.status).toBe("cancelled");
      expect(link.save).toHaveBeenCalled();
    });

    it("lanza NotFoundException si no existe", async () => {
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(null) });
      await expect(service.cancel(oid(), oid())).rejects.toThrow(
        NotFoundException,
      );
    });

    it("lanza ForbiddenException si el tenantId no coincide", async () => {
      const link = makeLink({ tenantId: new Types.ObjectId() });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(service.cancel(String(link._id), oid())).rejects.toThrow(
        ForbiddenException,
      );
    });

    it("lanza BadRequestException si el link ya está pagado", async () => {
      const tenantId = oid();
      const link = makeLink({
        tenantId: new Types.ObjectId(tenantId),
        status: "paid",
      });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(service.cancel(String(link._id), tenantId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ── markPaid ─────────────────────────────────────────────────────────────────

  describe("markPaid", () => {
    const dto = { paidWith: "zelle" };

    it("marca como paid desde active", async () => {
      const tenantId = oid();
      const link = makeLink({
        tenantId: new Types.ObjectId(tenantId),
        status: "active",
      });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await service.markPaid(String(link._id), tenantId, dto);

      expect(link.status).toBe("paid");
      expect(link.paidWith).toBe("zelle");
      expect(link.paidAt).toBeInstanceOf(Date);
    });

    it("marca como paid desde pending_verification (admin aprueba)", async () => {
      const tenantId = oid();
      const link = makeLink({
        tenantId: new Types.ObjectId(tenantId),
        status: "pending_verification",
      });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await service.markPaid(String(link._id), tenantId, dto);

      expect(link.status).toBe("paid");
    });

    it("lanza BadRequestException desde expired", async () => {
      const tenantId = oid();
      const link = makeLink({
        tenantId: new Types.ObjectId(tenantId),
        status: "expired",
      });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(
        service.markPaid(String(link._id), tenantId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza BadRequestException desde cancelled", async () => {
      const tenantId = oid();
      const link = makeLink({
        tenantId: new Types.ObjectId(tenantId),
        status: "cancelled",
      });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(
        service.markPaid(String(link._id), tenantId, dto),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza ForbiddenException si el tenant no coincide", async () => {
      const link = makeLink({ tenantId: new Types.ObjectId() });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(
        service.markPaid(String(link._id), oid(), dto),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ── submitTransfer ────────────────────────────────────────────────────────────

  describe("submitTransfer", () => {
    const dto = {
      receipt_url: "https://res.cloudinary.com/demo/transfer-receipt.jpg",
      transfer_reference: "REF-12345",
      transfer_amount: 100,
      transfer_currency: "USD" as const,
      transfer_sender_name: "Juan García",
      transfer_date: "2026-05-30",
      transfer_crosscheck: "match" as const,
    };

    it("transiciona active → pending_verification con campos transfer", async () => {
      const link = makeLink({ tenantSlug: "demo-negocio", status: "active" });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await service.submitTransfer(String(link._id), "demo-negocio", dto);

      expect(link.status).toBe("pending_verification");
      expect(link.transfer_receipt_url).toBe(dto.receipt_url);
      expect(link.transfer_reference).toBe("REF-12345");
      expect(link.transfer_amount).toBe(100);
      expect(link.transfer_currency).toBe("USD");
      expect(link.transfer_sender_name).toBe("Juan García");
      expect(link.transfer_date).toBe("2026-05-30");
      expect(link.transfer_crosscheck).toBe("match");
      expect((link as any).transfer_submitted_at).toBeInstanceOf(Date);
      expect(link.save).toHaveBeenCalled();
    });

    it("lanza NotFoundException si el link no existe", async () => {
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(null) });
      await expect(
        service.submitTransfer(oid(), "demo-negocio", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("lanza ForbiddenException si el tenantSlug no coincide", async () => {
      const link = makeLink({ tenantSlug: "otro-negocio", status: "active" });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(
        service.submitTransfer(String(link._id), "demo-negocio", dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it("lanza BadRequestException si el link no está active", async () => {
      const link = makeLink({
        tenantSlug: "demo-negocio",
        status: "pending_verification",
      });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(
        service.submitTransfer(String(link._id), "demo-negocio", dto),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza BadRequestException si el link está pagado", async () => {
      const link = makeLink({ tenantSlug: "demo-negocio", status: "paid" });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(
        service.submitTransfer(String(link._id), "demo-negocio", dto),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza BadRequestException si el link está cancelado", async () => {
      const link = makeLink({
        tenantSlug: "demo-negocio",
        status: "cancelled",
      });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(
        service.submitTransfer(String(link._id), "demo-negocio", dto),
      ).rejects.toThrow(BadRequestException);
    });

    it("campos opcionales se guardan como null si no se envían", async () => {
      const link = makeLink({ tenantSlug: "demo-negocio", status: "active" });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      const minimalDto = {
        receipt_url: "https://res.cloudinary.com/demo/receipt.jpg",
      };
      await service.submitTransfer(
        String(link._id),
        "demo-negocio",
        minimalDto as any,
      );

      expect(link.transfer_reference).toBeNull();
      expect(link.transfer_amount).toBeNull();
      expect(link.transfer_currency).toBeNull();
      expect(link.transfer_sender_name).toBeNull();
      expect(link.transfer_date).toBeNull();
      expect(link.transfer_crosscheck).toBeNull();
    });
  });

  // ── submitZelle ───────────────────────────────────────────────────────────────

  describe("submitZelle", () => {
    const dto = {
      receipt_url: "https://res.cloudinary.com/demo/zelle-receipt.jpg",
      zelle_amount: 50,
      zelle_reference: "Z-ABC123",
      zelle_sender_name: "Maria Pérez",
      zelle_sender_email: "maria@example.com",
      zelle_date: "2026-05-30",
      zelle_crosscheck: "match" as const,
    };

    it("transiciona active → pending_verification con campos zelle", async () => {
      const link = makeLink({ tenantSlug: "demo-negocio", status: "active" });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await service.submitZelle(String(link._id), "demo-negocio", dto);

      expect(link.status).toBe("pending_verification");
      expect(link.zelle_receipt_url).toBe(dto.receipt_url);
      expect(link.zelle_amount).toBe(50);
      expect(link.zelle_reference).toBe("Z-ABC123");
      expect(link.zelle_sender_name).toBe("Maria Pérez");
      expect(link.zelle_sender_email).toBe("maria@example.com");
      expect(link.zelle_date).toBe("2026-05-30");
      expect(link.zelle_crosscheck).toBe("match");
      expect((link as any).zelle_submitted_at).toBeInstanceOf(Date);
      expect(link.save).toHaveBeenCalled();
    });

    it("lanza NotFoundException si el link no existe", async () => {
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(null) });
      await expect(
        service.submitZelle(oid(), "demo-negocio", dto),
      ).rejects.toThrow(NotFoundException);
    });

    it("lanza ForbiddenException si el tenantSlug no coincide", async () => {
      const link = makeLink({ tenantSlug: "otro-negocio", status: "active" });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(
        service.submitZelle(String(link._id), "demo-negocio", dto),
      ).rejects.toThrow(ForbiddenException);
    });

    it("lanza BadRequestException si el link no está active", async () => {
      const link = makeLink({
        tenantSlug: "demo-negocio",
        status: "pending_verification",
      });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      await expect(
        service.submitZelle(String(link._id), "demo-negocio", dto),
      ).rejects.toThrow(BadRequestException);
    });

    it("campos opcionales se guardan como null si no se envían", async () => {
      const link = makeLink({ tenantSlug: "demo-negocio", status: "active" });
      mockModel.findById.mockReturnValue({ exec: () => Promise.resolve(link) });

      const minimalDto = {
        receipt_url: "https://res.cloudinary.com/demo/r.jpg",
      };
      await service.submitZelle(
        String(link._id),
        "demo-negocio",
        minimalDto as any,
      );

      expect(link.zelle_amount).toBeNull();
      expect(link.zelle_reference).toBeNull();
      expect(link.zelle_sender_name).toBeNull();
      expect(link.zelle_sender_email).toBeNull();
      expect(link.zelle_date).toBeNull();
      expect(link.zelle_crosscheck).toBeNull();
    });
  });

  // ── listByTenant ─────────────────────────────────────────────────────────────

  describe("listByTenant", () => {
    it("devuelve lista filtrada por tenantId", async () => {
      const tenantId = oid();
      const links = [makeLink(), makeLink()];
      mockModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(links),
      });

      const result = await service.listByTenant(tenantId);

      expect(result).toHaveLength(2);
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: new Types.ObjectId(tenantId) }),
      );
    });

    it("aplica filtro de status si se pasa", async () => {
      const tenantId = oid();
      mockModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      });

      await service.listByTenant(tenantId, "paid");

      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ status: "paid" }),
      );
    });
  });
});
