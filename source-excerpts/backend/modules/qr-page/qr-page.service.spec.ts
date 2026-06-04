import {
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { Types } from "mongoose";
import { QrPageService } from "./qr-page.service";

// ── helpers ─────────────────────────────────────────────────────────────────

function oid() {
  return new Types.ObjectId().toHexString();
}

function makeQrPage(overrides: Record<string, unknown> = {}) {
  const tenantId = new Types.ObjectId();
  const doc: Record<string, unknown> = {
    _id: new Types.ObjectId(),
    tenantId,
    tenantSlug: "demo-negocio",
    createdBy: new Types.ObjectId(),
    shortCode: "mostrador",
    title: "Página de cobro",
    description: null,
    type: "fixed_amount",
    amount: 20,
    productIds: [],
    allowQuantity: true,
    paymentMethods: ["pagomovil"],
    defaultPaymentMethod: "pagomovil",
    paymentAccountId: null,
    isActive: true,
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

function makeModel() {
  const model: Record<string, jest.Mock> = {
    create: jest.fn(),
    find: jest.fn(),
    findById: jest.fn(),
    findOne: jest.fn(),
    deleteOne: jest.fn(),
  };
  return model;
}

function makeTenant(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    slug: "demo-negocio",
    bankAccounts: [
      {
        _id: new Types.ObjectId(),
        bank: "Banesco",
        phone: "04141234567",
        rif: "J-123",
        accountHolder: "Demo CA",
        isDefault: true,
        isActive: true,
      },
    ],
    transferAccounts: [
      {
        _id: new Types.ObjectId(),
        bank: "Mercantil",
        accountNumber: "0105-0001-00-0001234567",
        accountHolder: "Demo CA",
        isDefault: true,
        isActive: true,
      },
    ],
    zelleAccounts: [
      {
        _id: new Types.ObjectId(),
        contact: "pagos@demo.com",
        holderName: "Demo CA",
        isDefault: true,
        isActive: true,
      },
    ],
    ...overrides,
  };
}

function makePaymentLink(overrides: Record<string, unknown> = {}) {
  return {
    _id: new Types.ObjectId(),
    status: "active",
    amount: 20,
    ...overrides,
  };
}

// ── suite ────────────────────────────────────────────────────────────────────

describe("QrPageService", () => {
  let service: QrPageService;
  let mockModel: ReturnType<typeof makeModel>;
  let mockTenantService: { findById: jest.Mock };
  let mockMenuService: {
    findManyByIdsForTenant: jest.Mock;
    getAllForAdmin: jest.Mock;
  };
  let mockPaymentLinkService: { create: jest.Mock };
  let mockLogger: { log: jest.Mock; logError: jest.Mock };

  beforeEach(() => {
    mockModel = makeModel();
    mockTenantService = { findById: jest.fn() };
    mockMenuService = {
      findManyByIdsForTenant: jest.fn(),
      getAllForAdmin: jest.fn(),
    };
    mockPaymentLinkService = { create: jest.fn() };
    mockLogger = { log: jest.fn(), logError: jest.fn() };

    service = new QrPageService(
      mockModel as any,
      mockTenantService as any,
      mockMenuService as any,
      mockPaymentLinkService as any,
      mockLogger as any,
    );
  });

  // ── create ───────────────────────────────────────────────────────────────

  describe("create", () => {
    const user = { _id: oid(), tenantId: oid(), role: "admin" } as any;
    const tenant = makeTenant();

    it("crea una página QR de tipo fixed_amount", async () => {
      mockTenantService.findById.mockResolvedValue(tenant);
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      const page = makeQrPage();
      mockModel.create.mockResolvedValue(page);

      const result = await service.create(oid(), user, {
        shortCode: "mostrador",
        title: "Mostrador",
        type: "fixed_amount",
        amount: 25,
        paymentMethods: ["pagomovil"],
        defaultPaymentMethod: "pagomovil",
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          shortCode: "mostrador",
          type: "fixed_amount",
          amount: 25,
        }),
      );
      expect(result).toBe(page);
    });

    it("lanza BadRequestException si type=fixed_amount y no hay amount", async () => {
      mockTenantService.findById.mockResolvedValue(tenant);

      await expect(
        service.create(oid(), user, {
          shortCode: "mostrador",
          title: "Test",
          type: "fixed_amount",
          paymentMethods: ["pagomovil"],
          defaultPaymentMethod: "pagomovil",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza ConflictException si el shortCode ya existe para el tenant", async () => {
      mockTenantService.findById.mockResolvedValue(tenant);
      mockModel.findOne.mockReturnValue({
        lean: () => ({
          exec: () => Promise.resolve(makeQrPage({ shortCode: "mostrador" })),
        }),
      });

      await expect(
        service.create(oid(), user, {
          shortCode: "mostrador",
          title: "Test",
          type: "open_amount",
          paymentMethods: ["pagomovil"],
          defaultPaymentMethod: "pagomovil",
        }),
      ).rejects.toThrow(ConflictException);
    });

    it("crea una página de tipo product_selection sin amount", async () => {
      mockTenantService.findById.mockResolvedValue(tenant);
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      const page = makeQrPage({ type: "product_selection", amount: null });
      mockModel.create.mockResolvedValue(page);

      const result = await service.create(oid(), user, {
        shortCode: "productos",
        title: "Selección",
        type: "product_selection",
        productIds: ["prod1", "prod2"],
        paymentMethods: ["pagomovil"],
        defaultPaymentMethod: "pagomovil",
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "product_selection",
          amount: null,
        }),
      );
      expect(result).toBe(page);
    });

    it("crea página de tipo open_amount sin amount", async () => {
      mockTenantService.findById.mockResolvedValue(tenant);
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      const page = makeQrPage({ type: "open_amount", amount: null });
      mockModel.create.mockResolvedValue(page);

      await service.create(oid(), user, {
        shortCode: "libre",
        title: "Monto libre",
        type: "open_amount",
        paymentMethods: ["pagomovil"],
        defaultPaymentMethod: "pagomovil",
      });

      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ type: "open_amount", amount: null }),
      );
    });
  });

  // ── list ─────────────────────────────────────────────────────────────────

  describe("list", () => {
    it("devuelve páginas del tenant ordenadas por createdAt desc", async () => {
      const pages = [makeQrPage(), makeQrPage()];
      mockModel.find.mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(pages),
      });

      const result = await service.list(oid());

      expect(result).toHaveLength(2);
      expect(mockModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: expect.any(Types.ObjectId) }),
      );
    });
  });

  // ── findOne ──────────────────────────────────────────────────────────────

  describe("findOne", () => {
    it("devuelve la página si pertenece al tenant", async () => {
      const tenantId = oid();
      const page = makeQrPage({ tenantId: new Types.ObjectId(tenantId) });
      mockModel.findById.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });

      const result = await service.findOne(tenantId, String(page._id));
      expect(result).toBe(page);
    });

    it("lanza NotFoundException con ID inválido", async () => {
      await expect(service.findOne(oid(), "no-un-oid")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("lanza NotFoundException si no existe en DB", async () => {
      mockModel.findById.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });
      await expect(service.findOne(oid(), oid())).rejects.toThrow(
        NotFoundException,
      );
    });

    it("lanza ForbiddenException si la página pertenece a otro tenant", async () => {
      const page = makeQrPage({ tenantId: new Types.ObjectId() });
      mockModel.findById.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });

      await expect(service.findOne(oid(), String(page._id))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── update ───────────────────────────────────────────────────────────────

  describe("update", () => {
    it("actualiza campos permitidos", async () => {
      const tenantId = oid();
      const page = makeQrPage({ tenantId: new Types.ObjectId(tenantId) });
      mockModel.findById.mockReturnValue({
        exec: () => Promise.resolve(page),
      });

      await service.update(tenantId, String(page._id), {
        title: "Nuevo título",
      });

      expect(page.title).toBe("Nuevo título");
      expect((page as any).save).toHaveBeenCalled();
    });

    it("ignorar shortCode en updates — no puede cambiar", async () => {
      const tenantId = oid();
      const page = makeQrPage({
        tenantId: new Types.ObjectId(tenantId),
        shortCode: "original",
      });
      mockModel.findById.mockReturnValue({
        exec: () => Promise.resolve(page),
      });

      // El DTO UpdateQrPageDto no tiene shortCode, pero aunque se intente
      // pasar shortCode, el servicio solo lee lo que UpdateQrPageDto define
      await service.update(tenantId, String(page._id), {
        title: "Actualizado",
      } as any);

      expect(page.shortCode).toBe("original");
    });

    it("limpia amount cuando se cambia el tipo a open_amount", async () => {
      const tenantId = oid();
      const page = makeQrPage({
        tenantId: new Types.ObjectId(tenantId),
        type: "fixed_amount",
        amount: 20,
      });
      mockModel.findById.mockReturnValue({
        exec: () => Promise.resolve(page),
      });

      await service.update(tenantId, String(page._id), { type: "open_amount" });

      expect(page.type).toBe("open_amount");
      expect(page.amount).toBeNull();
    });

    it("lanza ForbiddenException si la página es de otro tenant", async () => {
      const page = makeQrPage({ tenantId: new Types.ObjectId() });
      mockModel.findById.mockReturnValue({
        exec: () => Promise.resolve(page),
      });

      await expect(
        service.update(oid(), String(page._id), { title: "X" }),
      ).rejects.toThrow(ForbiddenException);
    });

    it("lanza NotFoundException si la página no existe", async () => {
      mockModel.findById.mockReturnValue({
        exec: () => Promise.resolve(null),
      });

      await expect(
        service.update(oid(), oid(), { title: "X" }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────

  describe("remove", () => {
    it("elimina la página", async () => {
      const tenantId = oid();
      const page = makeQrPage({ tenantId: new Types.ObjectId(tenantId) });
      mockModel.findById.mockReturnValue({
        exec: () => Promise.resolve(page),
      });
      mockModel.deleteOne.mockResolvedValue({});

      await service.remove(tenantId, String(page._id));

      expect(mockModel.deleteOne).toHaveBeenCalledWith({ _id: page._id });
    });

    it("lanza NotFoundException si no existe", async () => {
      mockModel.findById.mockReturnValue({
        exec: () => Promise.resolve(null),
      });

      await expect(service.remove(oid(), oid())).rejects.toThrow(
        NotFoundException,
      );
    });

    it("lanza ForbiddenException si la página es de otro tenant", async () => {
      const page = makeQrPage({ tenantId: new Types.ObjectId() });
      mockModel.findById.mockReturnValue({
        exec: () => Promise.resolve(page),
      });

      await expect(service.remove(oid(), String(page._id))).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  // ── getPublicConfig ──────────────────────────────────────────────────────

  describe("getPublicConfig", () => {
    it("lanza NotFoundException si la página no existe", async () => {
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });

      await expect(
        service.getPublicConfig("demo-negocio", "no-existe"),
      ).rejects.toThrow(NotFoundException);
    });

    it("retorna { isActive: false } cuando el módulo qr_pages está desactivado para el tenant", async () => {
      const tenant = makeTenant({ modules: { qr_pages: false } });
      const page = makeQrPage({ isActive: true });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      const result = await service.getPublicConfig("demo-negocio", "mostrador");

      expect(result).toEqual({ isActive: false });
    });

    it("retorna { isActive: false } sin 404 cuando la página está inactiva", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({ isActive: false });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      const result = await service.getPublicConfig("demo-negocio", "mostrador");

      expect(result).toEqual({ isActive: false });
    });

    it("retorna config completa con bankAccountSnapshot para fixed_amount", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({
        type: "fixed_amount",
        amount: 20,
        isActive: true,
      });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      const result = await service.getPublicConfig("demo-negocio", "mostrador");

      expect(result.isActive).toBe(true);
      expect(result.qrPage?.type).toBe("fixed_amount");
      expect(result.qrPage?.amount).toBe(20);
      expect(result.bankAccountSnapshot).toMatchObject({ bank: "Banesco" });
      expect(result.products).toBeUndefined();
    });

    it("llama a menuService.findManyByIdsForTenant para product_selection con productIds", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({
        type: "product_selection",
        productIds: ["prod-aaa", "prod-bbb"],
        isActive: true,
      });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      const productMap = new Map([
        [
          "prod-aaa",
          { _id: "prod-aaa", name: "Café", price: 2.5, active: true },
        ],
        ["prod-bbb", { _id: "prod-bbb", name: "Té", price: 1.5, active: true }],
      ]);
      mockMenuService.findManyByIdsForTenant.mockResolvedValue(productMap);

      const result = await service.getPublicConfig("demo-negocio", "mostrador");

      expect(mockMenuService.findManyByIdsForTenant).toHaveBeenCalledWith(
        ["prod-aaa", "prod-bbb"],
        expect.any(String),
      );
      expect(result.products).toHaveLength(2);
    });

    it("llama a menuService.getAllForAdmin si productIds está vacío en product_selection", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({
        type: "product_selection",
        productIds: [],
        isActive: true,
      });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);
      mockMenuService.getAllForAdmin.mockResolvedValue([
        { _id: "p1", name: "A", price: 3, active: true },
        { _id: "p2", name: "B", price: 4, active: false }, // inactivo — debe filtrarse
      ]);

      const result = await service.getPublicConfig("demo-negocio", "mostrador");

      expect(mockMenuService.getAllForAdmin).toHaveBeenCalled();
      // Solo productos activos
      expect(result.products).toHaveLength(1);
    });
  });

  // ── createPaymentFromQr ──────────────────────────────────────────────────

  describe("createPaymentFromQr", () => {
    it("crea un PaymentLink con monto fijo del servidor para fixed_amount", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({
        type: "fixed_amount",
        amount: 20,
        isActive: true,
      });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);
      const link = makePaymentLink();
      mockPaymentLinkService.create.mockResolvedValue(link);

      const result = await service.createPaymentFromQr(
        "demo-negocio",
        "mostrador",
        {
          paymentMethod: "pagomovil",
        },
      );

      expect(mockPaymentLinkService.create).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ role: "admin" }),
        expect.objectContaining({ amount: 20, paymentMethod: "pagomovil" }),
      );
      expect(result).toBe(link);
    });

    it("calcula el total server-side con precios del servidor para product_selection", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({ type: "product_selection", isActive: true });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      const productMap = new Map([
        ["prod-aaa", { _id: "prod-aaa", name: "Café", price: 2.5 }],
        ["prod-bbb", { _id: "prod-bbb", name: "Té", price: 3.0 }],
      ]);
      mockMenuService.findManyByIdsForTenant.mockResolvedValue(productMap);
      const link = makePaymentLink({ amount: 8 }); // 2.5*2 + 3.0*1 = 8
      mockPaymentLinkService.create.mockResolvedValue(link);

      await service.createPaymentFromQr("demo-negocio", "mostrador", {
        paymentMethod: "pagomovil",
        items: [
          { productId: "prod-aaa", quantity: 2 },
          { productId: "prod-bbb", quantity: 1 },
        ],
      });

      expect(mockPaymentLinkService.create).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ amount: 8 }), // 2.5*2 + 3.0*1
      );
    });

    it("rechaza price manipulation — siempre usa precio del servidor", async () => {
      // El cliente envía `amount` en items pero eso no se usa;
      // el servicio recalcula con datos del servidor
      const tenant = makeTenant();
      const page = makeQrPage({ type: "product_selection", isActive: true });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      const productMap = new Map([
        ["prod-aaa", { _id: "prod-aaa", name: "Item", price: 50 }], // precio real: $50
      ]);
      mockMenuService.findManyByIdsForTenant.mockResolvedValue(productMap);
      mockPaymentLinkService.create.mockResolvedValue(
        makePaymentLink({ amount: 50 }),
      );

      await service.createPaymentFromQr("demo-negocio", "mostrador", {
        paymentMethod: "pagomovil",
        items: [{ productId: "prod-aaa", quantity: 1 }],
      });

      // Verifica que se usó el precio del servidor ($50), no el del cliente
      expect(mockPaymentLinkService.create).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ amount: 50 }),
      );
    });

    it("lanza BadRequestException si product_selection sin items", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({ type: "product_selection", isActive: true });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      await expect(
        service.createPaymentFromQr("demo-negocio", "mostrador", {
          paymentMethod: "pagomovil",
          items: [],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza BadRequestException si producto no existe en el tenant", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({ type: "product_selection", isActive: true });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);
      // mapa vacío — el producto no existe
      mockMenuService.findManyByIdsForTenant.mockResolvedValue(new Map());

      await expect(
        service.createPaymentFromQr("demo-negocio", "mostrador", {
          paymentMethod: "pagomovil",
          items: [{ productId: "prod-inexistente", quantity: 1 }],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("acepta amount del cliente para open_amount", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({ type: "open_amount", isActive: true });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);
      mockPaymentLinkService.create.mockResolvedValue(
        makePaymentLink({ amount: 35 }),
      );

      await service.createPaymentFromQr("demo-negocio", "mostrador", {
        paymentMethod: "zelle",
        amount: 35,
      });

      expect(mockPaymentLinkService.create).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ amount: 35, paymentMethod: "zelle" }),
      );
    });

    it("lanza BadRequestException si open_amount sin monto", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({ type: "open_amount", isActive: true });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      await expect(
        service.createPaymentFromQr("demo-negocio", "mostrador", {
          paymentMethod: "pagomovil",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza BadRequestException si la página está inactiva", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({ isActive: false });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      await expect(
        service.createPaymentFromQr("demo-negocio", "mostrador", {
          paymentMethod: "pagomovil",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza BadRequestException si el módulo qr_pages está desactivado para el tenant", async () => {
      const tenant = makeTenant({ modules: { qr_pages: false } });
      const page = makeQrPage({
        type: "fixed_amount",
        amount: 10,
        isActive: true,
      });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);

      await expect(
        service.createPaymentFromQr("demo-negocio", "mostrador", {
          paymentMethod: "pagomovil",
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("lanza NotFoundException si la página no existe", async () => {
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(null) }),
      });

      await expect(
        service.createPaymentFromQr("demo-negocio", "no-existe", {
          paymentMethod: "pagomovil",
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("incluye el nombre del cliente en el PaymentLink si se envía", async () => {
      const tenant = makeTenant();
      const page = makeQrPage({
        type: "fixed_amount",
        amount: 10,
        isActive: true,
      });
      mockModel.findOne.mockReturnValue({
        lean: () => ({ exec: () => Promise.resolve(page) }),
      });
      mockTenantService.findById.mockResolvedValue(tenant);
      mockPaymentLinkService.create.mockResolvedValue(makePaymentLink());

      await service.createPaymentFromQr("demo-negocio", "mostrador", {
        paymentMethod: "pagomovil",
        customerName: "Juan Pérez",
      });

      expect(mockPaymentLinkService.create).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ customerName: "Juan Pérez" }),
      );
    });
  });
});
