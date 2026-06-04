import { NotFoundException } from "@nestjs/common";
import { Types } from "mongoose";
import { QuotationsService } from "./quotations.service";

// ── helpers ────────────────────────────────────────────────────────────────────

function oid() {
  return new Types.ObjectId().toHexString();
}

function makeDoc(overrides: Record<string, unknown> = {}) {
  return {
    _id: oid(),
    status: "draft",
    clientEmail: "",
    clientName: "Test Client",
    number: "COT-2025-001",
    items: [],
    ivaEnabled: false,
    ivaRate: 16,
    subtotal: 100,
    ivaAmount: 0,
    total: 100,
    date: new Date(),
    validUntil: new Date(),
    ...overrides,
  };
}

/** Cadena lean().exec() que devuelve un valor resuelto */
function leanChain(resolved: unknown) {
  return {
    lean: jest
      .fn()
      .mockReturnValue({ exec: jest.fn().mockResolvedValue(resolved) }),
  };
}

// ── suite ──────────────────────────────────────────────────────────────────────

describe("QuotationsService", () => {
  let service: QuotationsService;
  let mockModel: Record<string, jest.Mock>;
  let mockEmailService: { send: jest.Mock };

  beforeEach(() => {
    mockModel = {
      create: jest.fn(),
      countDocuments: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      deleteOne: jest.fn(),
      find: jest.fn(),
    };
    mockEmailService = { send: jest.fn().mockResolvedValue(undefined) };

    // Instanciación directa — más simple que TestingModule para unit tests puros
    service = new QuotationsService(
      mockModel as any,
      { log: jest.fn(), logError: jest.fn() } as any,
      mockEmailService as any,
    );
  });

  // ── calcTotals ───────────────────────────────────────────────────────────────

  describe("calcTotals — lógica de facturación (solo materiales)", () => {
    const calc = (items: object[], ivaEnabled: boolean, ivaRate = 16) =>
      (service as any).calcTotals(items, [], ivaEnabled, ivaRate);

    it("sin IVA: total = suma de subtotales", () => {
      const r = calc(
        [
          { quantity: 2, unitPrice: 10, subtotal: 20 },
          { quantity: 1, unitPrice: 5, subtotal: 5 },
        ],
        false,
      );
      expect(r.subtotal).toBe(25);
      expect(r.ivaAmount).toBe(0);
      expect(r.total).toBe(25);
      expect(r.materialsSubtotal).toBe(25);
      expect(r.laborSubtotal).toBe(0);
    });

    it("con IVA 16%: ivaAmount y total correctos", () => {
      const r = calc(
        [{ quantity: 1, unitPrice: 100, subtotal: 100 }],
        true,
        16,
      );
      expect(r.subtotal).toBe(100);
      expect(r.ivaAmount).toBe(16);
      expect(r.total).toBe(116);
    });

    it("usa quantity × unitPrice si subtotal no está en el item", () => {
      const r = calc([{ quantity: 4, unitPrice: 25 }], false);
      expect(r.subtotal).toBe(100);
      expect(r.total).toBe(100);
    });

    it("redondea ivaAmount a 2 decimales (99.99 × 16% = 16.00)", () => {
      const r = calc(
        [{ quantity: 1, unitPrice: 99.99, subtotal: 99.99 }],
        true,
        16,
      );
      expect(r.ivaAmount).toBe(16);
      expect(r.total).toBe(115.99);
    });

    it("múltiples ítems con IVA — subtotal 120, IVA 19.20, total 139.20", () => {
      const r = calc(
        [
          { quantity: 2, unitPrice: 50, subtotal: 100 },
          { quantity: 1, unitPrice: 20, subtotal: 20 },
        ],
        true,
        16,
      );
      expect(r.subtotal).toBe(120);
      expect(r.ivaAmount).toBe(19.2);
      expect(r.total).toBe(139.2);
    });

    it("IVA al 0% equivale a sin IVA", () => {
      const r = calc([{ quantity: 1, unitPrice: 50, subtotal: 50 }], true, 0);
      expect(r.subtotal).toBe(50);
      expect(r.ivaAmount).toBe(0);
      expect(r.total).toBe(50);
    });

    it("carrito vacío: todo cero", () => {
      const r = calc([], false);
      expect(r).toEqual({
        materialsSubtotal: 0,
        laborSubtotal: 0,
        subtotal: 0,
        ivaAmount: 0,
        total: 0,
      });
    });
  });

  describe("calcTotals — con mano de obra (labor_pricing)", () => {
    const calc = (
      items: object[],
      laborLines: object[],
      ivaEnabled: boolean,
      ivaRate = 16,
    ) => (service as any).calcTotals(items, laborLines, ivaEnabled, ivaRate);

    it("mano de obra por hora: 3h × $20 = $60 laborSubtotal", () => {
      const r = calc(
        [{ quantity: 1, unitPrice: 100, subtotal: 100 }],
        [{ hours: 3, ratePerHour: 20, fixedPrice: 0, subtotal: 60 }],
        false,
      );
      expect(r.materialsSubtotal).toBe(100);
      expect(r.laborSubtotal).toBe(60);
      expect(r.subtotal).toBe(160);
      expect(r.ivaAmount).toBe(0);
      expect(r.total).toBe(160);
    });

    it("mano de obra precio fijo: fixedPrice $80", () => {
      const r = calc(
        [{ quantity: 2, unitPrice: 50, subtotal: 100 }],
        [{ hours: 0, ratePerHour: 0, fixedPrice: 80, subtotal: 80 }],
        false,
      );
      expect(r.materialsSubtotal).toBe(100);
      expect(r.laborSubtotal).toBe(80);
      expect(r.subtotal).toBe(180);
      expect(r.total).toBe(180);
    });

    it("IVA aplica sobre materiales + mano de obra combinados", () => {
      const r = calc(
        [{ quantity: 1, unitPrice: 100, subtotal: 100 }],
        [{ hours: 0, ratePerHour: 0, fixedPrice: 50, subtotal: 50 }],
        true,
        16,
      );
      expect(r.subtotal).toBe(150);
      expect(r.ivaAmount).toBe(24);
      expect(r.total).toBe(174);
    });

    it("múltiples líneas de mano de obra", () => {
      const r = calc(
        [{ quantity: 1, unitPrice: 200, subtotal: 200 }],
        [
          { hours: 2, ratePerHour: 30, fixedPrice: 0, subtotal: 60 },
          { hours: 0, ratePerHour: 0, fixedPrice: 40, subtotal: 40 },
        ],
        false,
      );
      expect(r.materialsSubtotal).toBe(200);
      expect(r.laborSubtotal).toBe(100);
      expect(r.subtotal).toBe(300);
      expect(r.total).toBe(300);
    });

    it("sin labor lines: comportamiento igual al original", () => {
      const r = calc(
        [{ quantity: 1, unitPrice: 100, subtotal: 100 }],
        [],
        false,
      );
      expect(r.materialsSubtotal).toBe(100);
      expect(r.laborSubtotal).toBe(0);
      expect(r.subtotal).toBe(100);
      expect(r.total).toBe(100);
    });

    it("sin materiales, solo mano de obra con IVA", () => {
      const r = calc(
        [],
        [{ hours: 4, ratePerHour: 25, fixedPrice: 0, subtotal: 100 }],
        true,
        16,
      );
      expect(r.materialsSubtotal).toBe(0);
      expect(r.laborSubtotal).toBe(100);
      expect(r.subtotal).toBe(100);
      expect(r.ivaAmount).toBe(16);
      expect(r.total).toBe(116);
    });
  });

  // ── generateNumber ───────────────────────────────────────────────────────────

  describe("generateNumber — numeración automática", () => {
    const year = new Date().getFullYear();

    function mockCount(count: number) {
      mockModel.countDocuments.mockResolvedValue(count);
    }

    it("formato COT-{año}-001 cuando no hay cotizaciones previas", async () => {
      mockCount(0);
      expect(await (service as any).generateNumber(oid())).toBe(
        `COT-${year}-001`,
      );
    });

    it("incrementa el correlativo basado en el total existente", async () => {
      mockCount(12);
      expect(await (service as any).generateNumber(oid())).toBe(
        `COT-${year}-013`,
      );
    });

    it("padding de 3 dígitos — correlativo 099 → 100", async () => {
      mockCount(99);
      expect(await (service as any).generateNumber(oid())).toBe(
        `COT-${year}-100`,
      );
    });
  });

  // ── assertId ─────────────────────────────────────────────────────────────────

  describe("assertId", () => {
    it("lanza NotFoundException con ID inválido", () => {
      expect(() => (service as any).assertId("not-valid")).toThrow(
        NotFoundException,
      );
    });

    it("no lanza con ObjectId hexadecimal válido", () => {
      expect(() => (service as any).assertId(oid())).not.toThrow();
    });
  });

  // ── updateStatus ─────────────────────────────────────────────────────────────

  describe("updateStatus", () => {
    let sendEmailSpy: jest.SpyInstance;

    beforeEach(() => {
      sendEmailSpy = jest
        .spyOn(service as any, "sendQuotationEmail")
        .mockResolvedValue(undefined);
    });

    it("dispara email al pasar a sent con clientEmail", async () => {
      mockModel.findOneAndUpdate.mockReturnValue(
        leanChain(makeDoc({ status: "sent", clientEmail: "cliente@test.com" })),
      );
      await service.updateStatus(oid(), oid(), "sent");
      expect(sendEmailSpy).toHaveBeenCalledTimes(1);
    });

    it("no dispara email si clientEmail está vacío", async () => {
      mockModel.findOneAndUpdate.mockReturnValue(
        leanChain(makeDoc({ status: "sent", clientEmail: "" })),
      );
      await service.updateStatus(oid(), oid(), "sent");
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it("no dispara email para estados distintos a sent", async () => {
      mockModel.findOneAndUpdate.mockReturnValue(
        leanChain(
          makeDoc({ status: "accepted", clientEmail: "cliente@test.com" }),
        ),
      );
      await service.updateStatus(oid(), oid(), "accepted");
      expect(sendEmailSpy).not.toHaveBeenCalled();
    });

    it("lanza NotFoundException si el doc no existe", async () => {
      mockModel.findOneAndUpdate.mockReturnValue(leanChain(null));
      await expect(service.updateStatus(oid(), oid(), "sent")).rejects.toThrow(
        NotFoundException,
      );
    });

    it("retorna el documento actualizado", async () => {
      const doc = makeDoc({ status: "sent", clientEmail: "" });
      mockModel.findOneAndUpdate.mockReturnValue(leanChain(doc));
      const result = await service.updateStatus(oid(), oid(), "sent");
      expect(result).toEqual(doc);
    });
  });

  // ── remove ───────────────────────────────────────────────────────────────────

  describe("remove", () => {
    it("lanza NotFoundException si no encuentra el doc", async () => {
      mockModel.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 0 }),
      });
      await expect(service.remove(oid(), oid())).rejects.toThrow(
        NotFoundException,
      );
    });

    it("resuelve sin error si el doc existe", async () => {
      mockModel.deleteOne.mockReturnValue({
        exec: jest.fn().mockResolvedValue({ deletedCount: 1 }),
      });
      await expect(service.remove(oid(), oid())).resolves.toBeUndefined();
    });
  });
});
