import { PLAN_MODULE_MAP } from "@bia/types";

/**
 * Invariantes del mapa de planes.
 * Protege la fuente única de verdad para que un refactor no rompa
 * silenciosamente qué módulos tiene cada plan.
 *
 * Plan gates actuales:
 *   Starter: core de cada arquetipo + payment_links + product_variants + scheduled_orders
 *   Pro:     todo lo de Starter + qr_pages + advanced_analytics, delivery_zones,
 *            loyalty_program, finance_documents, quotation_builder, coupons_discounts
 *   Enterprise: todo habilitado (= Pro sin restricciones adicionales)
 *
 * Criterio Starter/Pro:
 *   Starter = operás el negocio desde el día 1.
 *   Pro     = crecés, fidelizás y profesionalizás.
 *   product_variants → Starter (retail no puede operar sin tallas/colores).
 *   qr_pages         → Pro (canal extra de venta, no el flujo operativo base).
 */
describe("PLAN_MODULE_MAP", () => {
  const plans = ["starter", "pro", "enterprise"] as const;

  /** Disponibles desde Starter — core de cada arquetipo */
  const starterModules = [
    "kitchen_kds",
    "product_modifiers",
    "product_variants", // retail core — tallas/colores imprescindibles desde día 1
    "inventory_tracking",
    "booking",
    "staff_management",
    "quotes_estimates",
    "labor_pricing",
    "payment_links", // core para booking/service — NO es Pro-only
    "scheduled_orders",
  ] as const;

  /** Bloqueados en Starter, disponibles en Pro+ */
  const proOnlyModules = [
    "qr_pages", // canal de cobro permanente — crecimiento, no operación base
    "advanced_analytics",
    "delivery_zones",
    "loyalty_program",
    "finance_documents",
    "quotation_builder",
    "coupons_discounts",
  ] as const;

  it("tiene exactamente los 3 planes definidos", () => {
    expect(Object.keys(PLAN_MODULE_MAP)).toEqual(
      expect.arrayContaining(["starter", "pro", "enterprise"]),
    );
    expect(Object.keys(PLAN_MODULE_MAP)).toHaveLength(3);
  });

  describe("starter", () => {
    const starter = PLAN_MODULE_MAP["starter"];

    it.each(starterModules)('módulo core "%s" está habilitado', (mod) => {
      expect(starter[mod]).toBe(true);
    });

    it.each(proOnlyModules)(
      'módulo Pro-only "%s" está deshabilitado en Starter',
      (mod) => {
        expect(starter[mod]).toBe(false);
      },
    );
  });

  describe("pro", () => {
    const pro = PLAN_MODULE_MAP["pro"];

    it.each(starterModules)(
      'módulo core "%s" sigue habilitado en Pro',
      (mod) => {
        expect(pro[mod]).toBe(true);
      },
    );

    it.each(proOnlyModules)(
      'módulo Pro-only "%s" está habilitado en Pro',
      (mod) => {
        expect(pro[mod]).toBe(true);
      },
    );
  });

  describe("enterprise", () => {
    const enterprise = PLAN_MODULE_MAP["enterprise"];

    it.each([...starterModules, ...proOnlyModules])(
      'módulo "%s" está habilitado en Enterprise',
      (mod) => {
        expect(enterprise[mod]).toBe(true);
      },
    );
  });

  it("starter es subconjunto de pro (pro tiene todo lo que tiene starter)", () => {
    const starter = PLAN_MODULE_MAP["starter"];
    const pro = PLAN_MODULE_MAP["pro"];
    for (const [key, val] of Object.entries(starter)) {
      if (val === true) {
        expect(pro[key as keyof typeof pro]).toBe(true);
      }
    }
  });

  it("pro es subconjunto de enterprise", () => {
    const pro = PLAN_MODULE_MAP["pro"];
    const enterprise = PLAN_MODULE_MAP["enterprise"];
    for (const [key, val] of Object.entries(pro)) {
      if (val === true) {
        expect(enterprise[key as keyof typeof enterprise]).toBe(true);
      }
    }
  });
});
