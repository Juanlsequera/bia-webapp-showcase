/**
 * Tests unitarios — PagomovilReceiptExtractor
 *
 * Cubre el postProcess (normalización de teléfono y cédula),
 * el schema (validación Zod), buildJsonSchema y buildPrompt.
 *
 * Sin LLM, sin red — todo determinístico.
 * Correr: pnpm --filter=api test pagomovil-receipt.extractor
 */

import { PagomovilReceiptExtractor } from "./pagomovil-receipt.extractor";
import type { PagomovilReceipt } from "./pagomovil-receipt.schema";
import { pagomovilReceiptSchema } from "./pagomovil-receipt.schema";
import _banesco from "../__fixtures__/pagomovil/banesco-normalized.json";
import _bbvaMinimal from "../__fixtures__/pagomovil/bbva-minimal.json";

const banesco = _banesco as PagomovilReceipt;
const bbvaMinimal = _bbvaMinimal as PagomovilReceipt;

describe("PagomovilReceiptExtractor", () => {
  const extractor = new PagomovilReceiptExtractor();

  // ── Metadata ────────────────────────────────────────────────────────────────
  describe("metadata", () => {
    it('type es "pagomovil-receipt"', () => {
      expect(extractor.type).toBe("pagomovil-receipt");
    });

    it("requiresAuth es false (cliente final sin login)", () => {
      expect(extractor.requiresAuth).toBe(false);
    });

    it("maxImageBytes es 5MB", () => {
      expect(extractor.maxImageBytes).toBe(5 * 1024 * 1024);
    });
  });

  // ── postProcess — teléfono beneficiario ─────────────────────────────────────
  describe("postProcess — normalización de teléfono", () => {
    it("elimina guiones del teléfono: 0414-1234567 → 04141234567", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryPhone: "0414-1234567",
      });
      expect(result.beneficiaryPhone).toBe("04141234567");
    });

    it("elimina espacios del teléfono: 0414 123 4567 → 04141234567", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryPhone: "0414 123 4567",
      });
      expect(result.beneficiaryPhone).toBe("04141234567");
    });

    it("normaliza teléfono de 10 dígitos que empieza en 4: 4141234567 → 04141234567", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryPhone: "4141234567",
      });
      expect(result.beneficiaryPhone).toBe("04141234567");
    });

    it("no modifica teléfono ya normalizado (11 dígitos)", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryPhone: "04141234567",
      });
      expect(result.beneficiaryPhone).toBe("04141234567");
    });

    it("acepta teléfono 0412 sin error", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryPhone: "04121234567",
      });
      expect(result.beneficiaryPhone).toBe("04121234567");
    });

    it("acepta beneficiaryPhone=null sin error", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryPhone: null,
      });
      expect(result.beneficiaryPhone).toBeNull();
    });

    it("no agrega 0 si el teléfono de 10 dígitos empieza en 0 (ya tiene el prefijo)", () => {
      // Un número que tiene 10 dígitos pero empieza en 0 (raro pero posible)
      // no debe duplicar el 0
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryPhone: "0141234567",
      });
      // Solo 10 dígitos sin empezar en 4 — no normaliza
      expect(result.beneficiaryPhone).toBe("0141234567");
    });
  });

  // ── postProcess — cédula beneficiario ───────────────────────────────────────
  describe("postProcess — normalización de cédula", () => {
    it("convierte V23811632 → V-23811632 (sin guión)", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryCedula: "V23811632",
      });
      expect(result.beneficiaryCedula).toBe("V-23811632");
    });

    it("mantiene V-23811632 sin cambios", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryCedula: "V-23811632",
      });
      expect(result.beneficiaryCedula).toBe("V-23811632");
    });

    it("elimina puntos: V-23.811.632 → V-23811632", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryCedula: "V-23.811.632",
      });
      expect(result.beneficiaryCedula).toBe("V-23811632");
    });

    it("normaliza minúsculas: v23811632 → V-23811632", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryCedula: "v23811632",
      });
      expect(result.beneficiaryCedula).toBe("V-23811632");
    });

    it("soporta formato J (jurídico): J123456789 → J-123456789", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryCedula: "J123456789",
      });
      expect(result.beneficiaryCedula).toBe("J-123456789");
    });

    it("soporta formato E (extranjero): E-12345678 sin cambios", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryCedula: "E-12345678",
      });
      expect(result.beneficiaryCedula).toBe("E-12345678");
    });

    it("acepta beneficiaryCedula=null sin error", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryCedula: null,
      });
      expect(result.beneficiaryCedula).toBeNull();
    });

    it("elimina puntos con guión en medio: V-23.811.632 → V-23811632", () => {
      const result = extractor.postProcess({
        ...banesco,
        beneficiaryCedula: "V-23.811.632",
      });
      expect(result.beneficiaryCedula).toBe("V-23811632");
    });
  });

  // ── postProcess — campos que no se modifican ────────────────────────────────
  describe("postProcess — campos que pasan sin cambio", () => {
    it("reference permanece sin modificar", () => {
      const result = extractor.postProcess({ ...banesco });
      expect(result.reference).toBe(banesco.reference);
    });

    it("amount permanece sin modificar", () => {
      const result = extractor.postProcess({ ...banesco });
      expect(result.amount).toBe(banesco.amount);
    });

    it("date permanece sin modificar (el frontend la normaliza)", () => {
      const result = extractor.postProcess({ ...banesco });
      expect(result.date).toBe(banesco.date);
    });

    it("suspicious permanece sin modificar", () => {
      const result = extractor.postProcess({ ...banesco, suspicious: true });
      expect(result.suspicious).toBe(true);
    });

    it("confidence permanece sin modificar", () => {
      const result = extractor.postProcess({ ...banesco });
      expect(result.confidence).toBe(banesco.confidence);
    });
  });

  // ── postProcess — fixture Banesco completo ───────────────────────────────────
  describe("postProcess — fixture Banesco normalizado", () => {
    it("fixture ya normalizado pasa sin cambios", () => {
      const result = extractor.postProcess({ ...banesco });
      expect(result.beneficiaryPhone).toBe("04141234567");
      expect(result.beneficiaryCedula).toBe("V-23811632");
      expect(result.isValidReceipt).toBe(true);
      expect(result.confidence).toBe("high");
      expect(result.suspicious).toBe(false);
    });
  });

  // ── postProcess — fixture BBVA minimal (sin cédula ni nombre) ───────────────
  describe("postProcess — fixture BBVA (sin cédula ni nombre)", () => {
    it("acepta cédula null y nombre null sin error", () => {
      const result = extractor.postProcess({ ...bbvaMinimal });
      expect(result.beneficiaryCedula).toBeNull();
      expect(result.beneficiaryName).toBeNull();
      expect(result.confidence).toBe("medium");
    });
  });

  // ── Schema Zod — campo suspicious ────────────────────────────────────────────
  describe("schema Zod — validación de suspicious", () => {
    it("parsea un objeto válido con suspicious=false", () => {
      const valid = { ...banesco };
      expect(() => pagomovilReceiptSchema.parse(valid)).not.toThrow();
    });

    it("parsea un objeto válido con suspicious=true", () => {
      const valid = { ...banesco, suspicious: true };
      const result = pagomovilReceiptSchema.parse(valid);
      expect(result.suspicious).toBe(true);
    });

    it("falla si suspicious falta (campo required)", () => {
      const invalid = { ...banesco };
      delete (invalid as any).suspicious;
      // Zod debe lanzar ZodError porque suspicious es boolean (no optional)
      expect(() => pagomovilReceiptSchema.parse(invalid)).toThrow();
    });

    it("falla si suspicious no es boolean", () => {
      const invalid = { ...banesco, suspicious: "maybe" };
      expect(() => pagomovilReceiptSchema.parse(invalid as any)).toThrow();
    });

    it("falla si confidence no está en el enum permitido", () => {
      const invalid = { ...banesco, confidence: "very_high" };
      expect(() => pagomovilReceiptSchema.parse(invalid as any)).toThrow();
    });

    it("falla si isValidReceipt falta", () => {
      const invalid = { ...banesco };
      delete (invalid as any).isValidReceipt;
      expect(() => pagomovilReceiptSchema.parse(invalid)).toThrow();
    });
  });

  // ── buildJsonSchema ───────────────────────────────────────────────────────────
  describe("buildJsonSchema", () => {
    it("devuelve objeto con required: [isValidReceipt, confidence, suspicious]", () => {
      const schema = extractor.buildJsonSchema() as { required: string[] };
      expect(schema.required).toContain("isValidReceipt");
      expect(schema.required).toContain("confidence");
      expect(schema.required).toContain("suspicious");
    });

    it("incluye la propiedad suspicious en properties", () => {
      const schema = extractor.buildJsonSchema() as {
        properties: Record<string, unknown>;
      };
      expect(schema.properties).toHaveProperty("suspicious");
    });

    it("suspicious es type boolean", () => {
      const schema = extractor.buildJsonSchema() as {
        properties: { suspicious: { type: string } };
      };
      expect(schema.properties.suspicious.type).toBe("boolean");
    });

    it("devuelve objeto con propiedad beneficiaryPhone", () => {
      const schema = extractor.buildJsonSchema() as {
        properties: Record<string, unknown>;
      };
      expect(schema.properties).toHaveProperty("beneficiaryPhone");
    });
  });

  // ── buildPrompt ───────────────────────────────────────────────────────────────
  describe("buildPrompt", () => {
    it("devuelve string con instrucciones de extracción (>500 chars)", () => {
      const prompt = extractor.buildPrompt();
      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(500);
    });

    it("incluye instrucciones sobre bancos venezolanos", () => {
      const prompt = extractor.buildPrompt();
      expect(prompt).toContain("Banesco");
      expect(prompt).toContain("BBVA Provincial");
    });

    it("incluye instrucción de detección de manipulación (suspicious)", () => {
      const prompt = extractor.buildPrompt();
      expect(prompt.toLowerCase()).toMatch(/suspi|manipul|fraude/);
    });

    it("incluye la distinción emisor vs beneficiario", () => {
      const prompt = extractor.buildPrompt();
      expect(prompt).toContain("EMISOR");
      expect(prompt).toContain("BENEFICIARIO");
    });

    it("incluye el expectedAmount en el contexto si se provee", () => {
      const prompt = extractor.buildPrompt({ expectedAmount: 500.25 });
      expect(prompt).toContain("500.25");
    });

    it("incluye el expectedBeneficiaryPhone en el contexto si se provee", () => {
      const prompt = extractor.buildPrompt({
        expectedBeneficiaryPhone: "04141234567",
      });
      expect(prompt).toContain("04141234567");
    });

    it("no incluye sección de contexto si no se provee", () => {
      const prompt = extractor.buildPrompt();
      expect(prompt).not.toContain("MONTO ESPERADO:");
    });
  });
});
