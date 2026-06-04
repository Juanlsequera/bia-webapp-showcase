import { ZelleReceiptExtractor } from "./zelle-receipt.extractor";
import type { ZelleReceiptExtracted } from "./zelle-receipt.schema";
import _bofaSent from "../__fixtures__/zelle/bofa-sent.json";
import _wellsReceived from "../__fixtures__/zelle/wells-received.json";

const bofaSent = _bofaSent as ZelleReceiptExtracted;
const wellsReceived = _wellsReceived as ZelleReceiptExtracted;

describe("ZelleReceiptExtractor", () => {
  const extractor = new ZelleReceiptExtractor();

  describe("metadata", () => {
    it('type es "zelle-receipt"', () => {
      expect(extractor.type).toBe("zelle-receipt");
    });

    it("requiresAuth es false", () => {
      expect(extractor.requiresAuth).toBe(false);
    });

    it("maxImageBytes es 5MB", () => {
      expect(extractor.maxImageBytes).toBe(5 * 1024 * 1024);
    });
  });

  describe("postProcess — normalización de fecha", () => {
    it("convierte MM/DD/YYYY (formato americano) → YYYY-MM-DD", () => {
      const result = extractor.postProcess({ ...bofaSent, date: "05/20/2026" });
      expect(result.date).toBe("2026-05-20");
    });

    it("convierte dd-mm-yyyy → YYYY-MM-DD", () => {
      const result = extractor.postProcess({ ...bofaSent, date: "20-05-2026" });
      expect(result.date).toBe("2026-05-20");
    });

    it("no modifica fecha ya en formato YYYY-MM-DD", () => {
      const result = extractor.postProcess({ ...bofaSent, date: "2026-05-20" });
      expect(result.date).toBe("2026-05-20");
    });

    it("acepta date=null sin error", () => {
      const result = extractor.postProcess({ ...bofaSent, date: null });
      expect(result.date).toBeNull();
    });
  });

  describe("postProcess — normalización de hora", () => {
    it("normaliza HH:MM:SS a HH:MM", () => {
      const result = extractor.postProcess({ ...bofaSent, time: "09:45:30" });
      expect(result.time).toBe("09:45");
    });

    it("acepta time=null sin error", () => {
      const result = extractor.postProcess({ ...bofaSent, time: null });
      expect(result.time).toBeNull();
    });
  });

  describe("postProcess — fuerza currency=USD para documentos válidos con monto", () => {
    it("establece currency=USD si el documento es válido y tiene monto", () => {
      const result = extractor.postProcess({ ...bofaSent, currency: null });
      expect(result.currency).toBe("USD");
    });

    it("no fuerza currency si amount es null", () => {
      const result = extractor.postProcess({
        ...bofaSent,
        amount: null,
        currency: null,
      });
      expect(result.currency).toBeNull();
    });
  });

  describe("postProcess — trim de campos de texto", () => {
    it("hace trim de senderName", () => {
      const result = extractor.postProcess({
        ...bofaSent,
        senderName: "  Juan Perez  ",
      });
      expect(result.senderName).toBe("Juan Perez");
    });

    it("colapsa espacios internos en bankApp", () => {
      const result = extractor.postProcess({
        ...bofaSent,
        bankApp: "Bank  of  America",
      });
      expect(result.bankApp).toBe("Bank of America");
    });

    it("hace trim del memo", () => {
      const result = extractor.postProcess({
        ...bofaSent,
        memo: "  Payment for services  ",
      });
      expect(result.memo).toBe("Payment for services");
    });
  });

  describe("postProcess — fixture completo BofA sent", () => {
    it("no modifica un fixture ya normalizado", () => {
      const result = extractor.postProcess({ ...bofaSent });
      expect(result.amount).toBe(150.0);
      expect(result.currency).toBe("USD");
      expect(result.bankApp).toBe("Bank of America");
      expect(result.reference).toBe("Z1234567890");
      expect(result.date).toBe("2026-05-20");
      expect(result.confidence).toBe("high");
    });
  });

  describe("postProcess — fixture completo Wells Fargo received", () => {
    it("mantiene datos del fixture de Wells Fargo", () => {
      const result = extractor.postProcess({ ...wellsReceived });
      expect(result.amount).toBe(250.0);
      expect(result.bankApp).toBe("Wells Fargo");
      expect(result.senderName).toBe("Carlos Rodriguez");
    });
  });

  describe("postProcess — documento inválido", () => {
    it("devuelve isValidDocument=false sin tocar otros campos", () => {
      const invalid = {
        ...bofaSent,
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
    it("devuelve objeto con required: [isValidDocument, confidence]", () => {
      const schema = extractor.buildJsonSchema();
      expect((schema as any).required).toContain("isValidDocument");
      expect((schema as any).required).toContain("confidence");
    });
  });

  describe("buildPrompt", () => {
    it("devuelve string no vacío con menciones de Zelle y bancos US", () => {
      const prompt = extractor.buildPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(200);
      expect(prompt).toContain("Zelle");
      expect(prompt).toContain("Wells Fargo");
      expect(prompt).toContain("USD");
    });
  });
});
