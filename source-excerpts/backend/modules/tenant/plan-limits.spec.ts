import { BadRequestException } from "@nestjs/common";
import { getModelToken } from "@nestjs/mongoose";
import { Test, TestingModule } from "@nestjs/testing";
import { Types } from "mongoose";
import { TenantService } from "./tenant.service";
import { Tenant } from "./schemas/tenant.schema";
import { User } from "../auth/schemas/user.schema";
import { AuthService } from "../auth/auth.service";
import { AppLogger } from "../logger/logger.service";
import { BcvRateService } from "../bcv-rate/bcv-rate.service";

/** Construye un mock de Mongoose model a partir de un documento fijo. */
function mockModel(doc: Record<string, unknown>) {
  return {
    findById: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue(doc),
      }),
    }),
    findByIdAndUpdate: jest.fn().mockReturnValue({
      lean: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ ...doc }),
      }),
      exec: jest.fn().mockResolvedValue({ ...doc }),
    }),
    findOne: jest.fn().mockReturnValue({
      lean: jest
        .fn()
        .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
    }),
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest
          .fn()
          .mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
      }),
    }),
    create: jest.fn(),
  };
}

const TENANT_ID = new Types.ObjectId().toHexString();
const BANK_DTO = {
  bank: "Banesco",
  phone: "04141234567",
  rif: "V-12345678",
  accountHolder: "Test C.A.",
};
const ZELLE_DTO = {
  contactType: "email" as const,
  contact: "test@example.com",
  holderName: "Test User",
};
const TRANSFER_DTO = {
  subtype: "national" as const,
  currency: "VES" as const,
  accountHolder: "Test C.A.",
};

describe("Plan limits enforcement", () => {
  describe("addBankAccount — PagoMóvil", () => {
    it("starter: permite agregar la primera cuenta", async () => {
      const tenantDoc = { _id: TENANT_ID, plan: "starter", bankAccounts: [] };
      const tenantModelMock = mockModel(tenantDoc);
      const service = await buildService(tenantModelMock);

      const result = await service.addBankAccount(TENANT_ID, BANK_DTO as any);
      expect(result).toBeDefined();
    });

    it("starter: lanza BadRequestException al intentar agregar la segunda cuenta", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "starter",
        bankAccounts: [
          { _id: new Types.ObjectId(), bank: "BDV", isActive: true },
        ],
      };
      const tenantModelMock = mockModel(tenantDoc);
      const service = await buildService(tenantModelMock);

      await expect(
        service.addBankAccount(TENANT_ID, BANK_DTO as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("starter: el mensaje menciona editar la cuenta existente", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "starter",
        bankAccounts: [
          { _id: new Types.ObjectId(), bank: "BDV", isActive: true },
        ],
      };
      const tenantModelMock = mockModel(tenantDoc);
      const service = await buildService(tenantModelMock);

      await expect(
        service.addBankAccount(TENANT_ID, BANK_DTO as any),
      ).rejects.toThrow(/edit/i);
    });

    it("starter: una cuenta INACTIVA también bloquea la creación de una segunda", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "starter",
        bankAccounts: [
          { _id: new Types.ObjectId(), bank: "BDV", isActive: false },
        ],
      };
      const tenantModelMock = mockModel(tenantDoc);
      const service = await buildService(tenantModelMock);

      await expect(
        service.addBankAccount(TENANT_ID, BANK_DTO as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("pro: permite agregar más allá de 1 cuenta", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "pro",
        bankAccounts: [
          { _id: new Types.ObjectId(), bank: "BDV", isActive: true },
        ],
      };
      const tenantModelMock = mockModel(tenantDoc);
      const service = await buildService(tenantModelMock);

      const result = await service.addBankAccount(TENANT_ID, BANK_DTO as any);
      expect(result).toBeDefined();
    });

    it("enterprise: sin límite", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "enterprise",
        bankAccounts: [
          { _id: new Types.ObjectId(), bank: "BDV", isActive: true },
          { _id: new Types.ObjectId(), bank: "Banesco", isActive: true },
        ],
      };
      const tenantModelMock = mockModel(tenantDoc);
      const service = await buildService(tenantModelMock);

      const result = await service.addBankAccount(TENANT_ID, BANK_DTO as any);
      expect(result).toBeDefined();
    });

    it("tenant sin campo plan (legacy) se trata como starter", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        // plan ausente — simula tenant legacy
        bankAccounts: [
          { _id: new Types.ObjectId(), bank: "BDV", isActive: true },
        ],
      };
      const tenantModelMock = mockModel(tenantDoc);
      const service = await buildService(tenantModelMock);

      await expect(
        service.addBankAccount(TENANT_ID, BANK_DTO as any),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe("addZelleAccount", () => {
    it("starter: lanza BadRequestException al intentar agregar la segunda cuenta", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "starter",
        zelleAccounts: [
          { _id: new Types.ObjectId(), contact: "a@b.com", isActive: true },
        ],
      };
      const service = await buildService(mockModel(tenantDoc));

      await expect(
        service.addZelleAccount(TENANT_ID, ZELLE_DTO as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("starter: cuenta inactiva también bloquea creación de segunda", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "starter",
        zelleAccounts: [
          { _id: new Types.ObjectId(), contact: "a@b.com", isActive: false },
        ],
      };
      const service = await buildService(mockModel(tenantDoc));

      await expect(
        service.addZelleAccount(TENANT_ID, ZELLE_DTO as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("pro: sin límite", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "pro",
        zelleAccounts: [
          { _id: new Types.ObjectId(), contact: "a@b.com", isActive: true },
        ],
      };
      const service = await buildService(mockModel(tenantDoc));

      const result = await service.addZelleAccount(TENANT_ID, ZELLE_DTO as any);
      expect(result).toBeDefined();
    });
  });

  describe("addTransferAccount", () => {
    it("starter: lanza BadRequestException al intentar agregar la segunda cuenta", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "starter",
        transferAccounts: [
          { _id: new Types.ObjectId(), accountHolder: "A", isActive: true },
        ],
      };
      const service = await buildService(mockModel(tenantDoc));

      await expect(
        service.addTransferAccount(TENANT_ID, TRANSFER_DTO as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("starter: cuenta inactiva también bloquea creación de segunda", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "starter",
        transferAccounts: [
          { _id: new Types.ObjectId(), accountHolder: "A", isActive: false },
        ],
      };
      const service = await buildService(mockModel(tenantDoc));

      await expect(
        service.addTransferAccount(TENANT_ID, TRANSFER_DTO as any),
      ).rejects.toThrow(BadRequestException);
    });

    it("pro: sin límite", async () => {
      const tenantDoc = {
        _id: TENANT_ID,
        plan: "pro",
        transferAccounts: [
          { _id: new Types.ObjectId(), accountHolder: "A", isActive: true },
        ],
      };
      const service = await buildService(mockModel(tenantDoc));

      const result = await service.addTransferAccount(
        TENANT_ID,
        TRANSFER_DTO as any,
      );
      expect(result).toBeDefined();
    });
  });
});

/** Helper: construye el TenantService con el tenantModel mock dado. */
async function buildService(tenantModelMock: ReturnType<typeof mockModel>) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TenantService,
      {
        provide: getModelToken(Tenant.name),
        useValue: tenantModelMock,
      },
      {
        provide: getModelToken(User.name),
        useValue: {
          findOne: jest.fn().mockReturnValue({
            lean: jest
              .fn()
              .mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
          }),
        },
      },
      {
        provide: AuthService,
        useValue: { createUser: jest.fn() },
      },
      {
        provide: AppLogger,
        useValue: { log: jest.fn(), logError: jest.fn() },
      },
      {
        provide: BcvRateService,
        useValue: { getCurrent: jest.fn() },
      },
    ],
  }).compile();

  return module.get<TenantService>(TenantService);
}
