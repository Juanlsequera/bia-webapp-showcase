import { TransferReceiptExtractor } from "./transfer-receipt.extractor";
import type { TransferReceiptExtracted } from "./transfer-receipt.schema";
import _banescode from "../__fixtures__/transfer/banesco-ves.json";
import _mercantilUsd from "../__fixtures__/transfer/mercantil-usd.json";

const banescode = _banescode as TransferReceiptExtracted;
const mercantilUsd = _mercantilUsd as TransferReceiptExtracted;

describe("TransferReceiptExtractor", () => {
  const extractor = new TransferReceiptExtractor();

  describe("metadata", () => {
    it('type es "transfer-receipt"', () => {
      expect(extractor.type).toBe("transfer-receipt");
    });

    it("requiresAuth es false", () => {
      expect(extractor.requiresAuth).toBe(false);
    });

    it("maxImageBytes es 5MB", () => {
      expect(extractor.maxImageBytes).toBe(5 * 1024 * 1024);
    });
  });

  describe("postProcess — normalización de fecha", () => {
    it("convierte dd/mm/yyyy → YYYY-MM-DD", () => {
      const result = extractor.postProcess({
        ...banescode,
        date: "15/05/2026",
      });
      expect(result.date).toBe("2026-05-15");
    });

    it("convierte dd-mm-yyyy → YYYY-MM-DD", () => {
      const result = extractor.postProcess({
        ...banescode,
        date: "15-05-2026",
      });
      expect(result.date).toBe("2026-05-15");
    });

    it("no modifica fecha ya en formato YYYY-MM-DD", () => {
      const result = extractor.postProcess({
        ...banescode,
        date: "2026-05-15",
      });
      expect(result.date).toBe("2026-05-15");
    });

    it("acepta date=null sin error", () => {
      const result = extractor.postProcess({ ...banescode, date: null });
      expect(result.date).toBeNull();
    });
  });

  describe("postProcess — normalización de hora", () => {
    it("normaliza HH:MM:SS a HH:MM", () => {
      const result = extractor.postProcess({ ...banescode, time: "14:32:45" });
      expect(result.time).toBe("14:32");
    });

    it("normaliza H:MM a HH:MM", () => {
      const result = extractor.postProcess({ ...banescode, time: "9:05" });
      expect(result.time).toBe("09:05");
    });

    it("acepta time=null sin error", () => {
      const result = extractor.postProcess({ ...banescode, time: null });
      expect(result.time).toBeNull();
    });
  });

  describe("postProcess — trim de campos de texto", () => {
    it("hace trim del nombre del banco", () => {
      const result = extractor.postProcess({
        ...banescode,
        bank: "  Banesco  ",
      });
      expect(result.bank).toBe("Banesco");
    });

    it("colapsa espacios internos en recipientName", () => {
      const result = extractor.postProcess({
        ...banescode,
        recipientName: "Comercial   XYZ  C.A.",
      });
      expect(result.recipientName).toBe("Comercial XYZ C.A.");
    });

    it("hace trim del concepto", () => {
      const result = extractor.postProcess({
        ...banescode,
        concept: "  Pago servicios  ",
      });
      expect(result.concept).toBe("Pago servicios");
    });
  });

  describe("postProcess — fixture completo banesco VES", () => {
    it("no modifica un fixture ya normalizado", () => {
      const result = extractor.postProcess({ ...banescode });
      expect(result.bank).toBe("Banesco");
      expect(result.currency).toBe("VES");
      expect(result.amount).toBe(1500000.0);
      expect(result.reference).toBe("240515001");
      expect(result.date).toBe("2026-05-15");
      expect(result.confidence).toBe("high");
    });
  });

  describe("postProcess — fixture completo mercantil USD", () => {
    it("mantiene currency USD y monto correcto", () => {
      const result = extractor.postProcess({ ...mercantilUsd });
      expect(result.currency).toBe("USD");
      expect(result.amount).toBe(350.0);
      expect(result.bank).toBe("Mercantil");
    });
  });

  describe("postProcess — documento inválido", () => {
    it("devuelve isValidDocument=false sin tocar otros campos", () => {
      const invalid = {
        ...banescode,
        isValidDocument: false,
        amount: null,
        currency: null,
      };
      const result = extractor.postProcess(invalid as any);
      expect(result.isValidDocument).toBe(false);
      expect(result.amount).toBeNull();
    });
  });

  describe("buildJsonSchema", () => {
    it("devuelve un objeto con required: [isValidDocument, confidence]", () => {
      const schema = extractor.buildJsonSchema();
      expect((schema as any).required).toContain("isValidDocument");
      expect((schema as any).required).toContain("confidence");
    });
  });

  describe("buildPrompt", () => {
    it("devuelve string no vacío con menciones de bancos VE", () => {
      const prompt = extractor.buildPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(200);
      expect(prompt).toContain("Banesco");
      expect(prompt).toContain("PagoMóvil");
    });
  });
});
