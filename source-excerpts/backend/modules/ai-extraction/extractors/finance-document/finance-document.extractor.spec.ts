/**
 * Tests unitarios — FinanceDocumentExtractor
 *
 * Cubre el postProcess (normalización de fecha, supplier, description),
 * el schema Zod, buildJsonSchema y buildPrompt.
 *
 * Sin LLM, sin red — todo determinístico.
 * Correr: pnpm --filter=api test finance-document.extractor
 */

import { FinanceDocumentExtractor } from "./finance-document.extractor";
import type { FinanceDocumentExtracted } from "./finance-document.schema";
import { financeDocumentSchema } from "./finance-document.schema";
import _invoiceEgreso from "../__fixtures__/finance/invoice-egreso.json";
import _receiptIngreso from "../__fixtures__/finance/receipt-ingreso.json";

const invoiceEgreso = _invoiceEgreso as FinanceDocumentExtracted;
const receiptIngreso = _receiptIngreso as FinanceDocumentExtracted;

describe("FinanceDocumentExtractor", () => {
  const extractor = new FinanceDocumentExtractor();

  // ── Metadata ────────────────────────────────────────────────────────────────
  describe("metadata", () => {
    it('type es "finance-document"', () => {
      expect(extractor.type).toBe("finance-document");
    });

    it("requiresAuth es true (solo admins pueden usarlo)", () => {
      expect(extractor.requiresAuth).toBe(true);
    });

    it("maxImageBytes es 8MB (facturas pueden ser más densas)", () => {
      expect(extractor.maxImageBytes).toBe(8 * 1024 * 1024);
    });
  });

  // ── postProcess — normalización de fecha ────────────────────────────────────
  describe("postProcess — normalización de fecha", () => {
    it("convierte dd/mm/yyyy → YYYY-MM-DD", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        date: "15/05/2026",
      });
      expect(result.date).toBe("2026-05-15");
    });

    it("convierte d/m/yyyy (sin cero) → YYYY-MM-DD", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        date: "5/1/2026",
      });
      expect(result.date).toBe("2026-01-05");
    });

    it("convierte dd-mm-yyyy → YYYY-MM-DD", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        date: "15-05-2026",
      });
      expect(result.date).toBe("2026-05-15");
    });

    it("no modifica fecha ya en formato YYYY-MM-DD", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        date: "2026-05-15",
      });
      expect(result.date).toBe("2026-05-15");
    });

    it("acepta date=null sin error", () => {
      const result = extractor.postProcess({ ...invoiceEgreso, date: null });
      expect(result.date).toBeNull();
    });
  });

  // ── postProcess — normalización de supplier ──────────────────────────────────
  describe("postProcess — normalización de supplier", () => {
    it("hace trim de espacios al inicio y fin", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        supplier: "  Distribuidora El Sol  ",
      });
      expect(result.supplier).toBe("Distribuidora El Sol");
    });

    it("colapsa espacios internos múltiples", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        supplier: "Distribuidora  El   Sol",
      });
      expect(result.supplier).toBe("Distribuidora El Sol");
    });

    it("acepta supplier=null sin error", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        supplier: null,
      });
      expect(result.supplier).toBeNull();
    });
  });

  // ── postProcess — normalización de description ───────────────────────────────
  describe("postProcess — normalización de description", () => {
    it("hace trim de la descripción", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        description: "  Compra de ingredientes  ",
      });
      expect(result.description).toBe("Compra de ingredientes");
    });

    it("colapsa espacios internos en la descripción", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        description: "Compra  de  ingredientes",
      });
      expect(result.description).toBe("Compra de ingredientes");
    });

    it("acepta description=null sin error", () => {
      const result = extractor.postProcess({
        ...invoiceEgreso,
        description: null,
      });
      expect(result.description).toBeNull();
    });
  });

  // ── postProcess — fixture factura egreso ────────────────────────────────────
  describe("postProcess — fixture factura egreso", () => {
    it("normaliza el fixture de factura: fecha + supplier + description", () => {
      const result = extractor.postProcess({ ...invoiceEgreso });
      // Fecha dd/mm/yyyy → YYYY-MM-DD
      expect(result.date).toBe("2026-05-15");
      // Supplier con espacios extra → trimmed
      expect(result.supplier).toBe("Distribuidora El Sol");
      // Description con espacios extra → trimmed
      expect(result.description).toBe(
        "Compra de ingredientes para restaurante",
      );
      // Campos no tocados por postProcess
      expect(result.amount).toBe(450.0);
      expect(result.currency).toBe("USD");
      expect(result.type).toBe("egreso");
      expect(result.items).toHaveLength(2);
    });
  });

  // ── postProcess — fixture recibo ingreso ─────────────────────────────────────
  describe("postProcess — fixture recibo ingreso", () => {
    it("no modifica fixture ya normalizado", () => {
      const result = extractor.postProcess({ ...receiptIngreso });
      expect(result.date).toBe("2026-05-20");
      expect(result.supplier).toBe("Carlos Rodriguez");
      expect(result.type).toBe("ingreso");
      expect(result.items).toHaveLength(0);
    });
  });

  // ── Schema Zod ───────────────────────────────────────────────────────────────
  describe("schema Zod", () => {
    it("parsea un documento de egreso válido", () => {
      const data = {
        ...invoiceEgreso,
        date: "2026-05-15", // ya normalizado
        supplier: "Distribuidora El Sol",
        description: "Compra de ingredientes para restaurante",
      };
      expect(() => financeDocumentSchema.parse(data)).not.toThrow();
    });

    it("parsea un documento de ingreso válido", () => {
      expect(() => financeDocumentSchema.parse(receiptIngreso)).not.toThrow();
    });

    it("falla si isValidDocument falta", () => {
      const invalid = { ...receiptIngreso };
      delete (invalid as any).isValidDocument;
      expect(() => financeDocumentSchema.parse(invalid)).toThrow();
    });

    it("falla si confidence no está en el enum", () => {
      const invalid = { ...receiptIngreso, confidence: "very_high" };
      expect(() => financeDocumentSchema.parse(invalid as any)).toThrow();
    });

    it("falla si type no está en el enum (ingreso|egreso)", () => {
      const invalid = { ...receiptIngreso, type: "gasto" };
      expect(() => financeDocumentSchema.parse(invalid as any)).toThrow();
    });

    it("acepta items vacío por defecto (default: [])", () => {
      const noItems = { ...receiptIngreso };
      delete (noItems as any).items;
      const result = financeDocumentSchema.parse(noItems);
      expect(result.items).toEqual([]);
    });

    it("acepta items con objetos válidos", () => {
      const withItems = {
        ...receiptIngreso,
        items: [
          {
            description: "Servicio A",
            quantity: 2,
            unitPrice: 100,
            total: 200,
          },
        ],
      };
      const result = financeDocumentSchema.parse(withItems);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].description).toBe("Servicio A");
    });

    it("acepta documento inválido con isValidDocument=false y campos null", () => {
      const invalid = {
        isValidDocument: false,
        documentType: null,
        type: null,
        date: null,
        supplier: null,
        description: null,
        amount: null,
        currency: null,
        items: [],
        confidence: "low",
        notes: null,
      };
      expect(() => financeDocumentSchema.parse(invalid)).not.toThrow();
    });
  });

  // ── buildJsonSchema ───────────────────────────────────────────────────────────
  describe("buildJsonSchema", () => {
    it("devuelve objeto con required: [isValidDocument, confidence, items]", () => {
      const schema = extractor.buildJsonSchema() as { required: string[] };
      expect(schema.required).toContain("isValidDocument");
      expect(schema.required).toContain("confidence");
      expect(schema.required).toContain("items");
    });

    it("incluye type (ingreso/egreso) en properties", () => {
      const schema = extractor.buildJsonSchema() as {
        properties: Record<string, unknown>;
      };
      expect(schema.properties).toHaveProperty("type");
    });

    it("incluye currency en properties", () => {
      const schema = extractor.buildJsonSchema() as {
        properties: Record<string, unknown>;
      };
      expect(schema.properties).toHaveProperty("currency");
    });

    it("devuelve array schema para items", () => {
      const schema = extractor.buildJsonSchema() as {
        properties: { items: { type: string } };
      };
      expect(schema.properties.items.type).toBe("array");
    });
  });

  // ── buildPrompt ───────────────────────────────────────────────────────────────
  describe("buildPrompt", () => {
    it("devuelve string con instrucciones de extracción (>300 chars)", () => {
      const prompt = extractor.buildPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(300);
    });

    it("menciona facturas e ingresos/egresos", () => {
      const prompt = extractor.buildPrompt();
      expect(prompt.toLowerCase()).toMatch(/factura|recibo|ingreso|egreso/);
    });

    it("menciona monedas (USD/VES)", () => {
      const prompt = extractor.buildPrompt();
      expect(prompt).toMatch(/USD|VES|bol[ií]var/i);
    });
  });
});
