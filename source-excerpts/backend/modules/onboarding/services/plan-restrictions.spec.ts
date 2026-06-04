import {
  PLAN_MODULE_MAP,
  getDefaultModulesForArchetype,
} from "@foodorder/types";

/**
 * Tests de la lógica de restricciones de plan en el onboarding.
 *
 * Replica el cálculo real de onboarding.service.ts para verificar que
 * las restricciones del plan siempre ganan sobre los defaults del arquetipo
 * y las elecciones del wizard.
 */
function computeModulesWithPlanRestrictions(
  archetype: "food" | "retail" | "booking" | "service",
  templateDefaults: Record<string, boolean>,
  wizardChoices: Record<string, boolean>,
  plan: "starter" | "pro" | "enterprise",
): Record<string, boolean> {
  const planMap = PLAN_MODULE_MAP[plan] ?? {};
  const planRestrictions = Object.fromEntries(
    Object.entries(planMap).filter(([, v]) => v === false),
  );
  return {
    ...getDefaultModulesForArchetype(archetype),
    ...templateDefaults,
    ...wizardChoices,
    ...planRestrictions,
  } as Record<string, boolean>;
}

describe("Onboarding: restricciones de plan sobre módulos", () => {
  describe("plan starter", () => {
    it("fuerza finance_documents a false aunque el template lo active", () => {
      const modules = computeModulesWithPlanRestrictions(
        "service",
        { finance_documents: true }, // template lo activa
        {},
        "starter",
      );
      expect(modules.finance_documents).toBe(false);
    });

    it("permite payment_links en starter (es core para booking/service)", () => {
      // payment_links ya NO es Pro-only — booking y service lo necesitan desde Starter
      const modules = computeModulesWithPlanRestrictions(
        "booking",
        {},
        { payment_links: true },
        "starter",
      );
      expect(modules.payment_links).toBe(true);
    });

    it("fuerza loyalty_program a false en starter (Pro-only)", () => {
      const modules = computeModulesWithPlanRestrictions(
        "retail",
        { loyalty_program: true }, // template lo activa
        {},
        "starter",
      );
      expect(modules.loyalty_program).toBe(false);
    });

    it("fuerza coupons_discounts a false en starter (Pro-only)", () => {
      const modules = computeModulesWithPlanRestrictions(
        "food",
        { coupons_discounts: true },
        {},
        "starter",
      );
      expect(modules.coupons_discounts).toBe(false);
    });

    it("fuerza advanced_analytics a false", () => {
      const modules = computeModulesWithPlanRestrictions(
        "food",
        {},
        { advanced_analytics: true },
        "starter",
      );
      expect(modules.advanced_analytics).toBe(false);
    });

    it("fuerza quotation_builder a false", () => {
      const modules = computeModulesWithPlanRestrictions(
        "booking",
        { quotation_builder: true },
        {},
        "starter",
      );
      expect(modules.quotation_builder).toBe(false);
    });

    it("mantiene módulos core habilitados (kitchen_kds, booking, etc.)", () => {
      const modules = computeModulesWithPlanRestrictions(
        "food",
        {},
        {},
        "starter",
      );
      expect(modules.kitchen_kds).toBe(true);
      expect(modules.product_modifiers).toBe(true);
    });
  });

  describe("plan pro", () => {
    it("permite finance_documents habilitado", () => {
      const modules = computeModulesWithPlanRestrictions(
        "service",
        { finance_documents: true },
        {},
        "pro",
      );
      expect(modules.finance_documents).toBe(true);
    });

    it("permite payment_links habilitado", () => {
      const modules = computeModulesWithPlanRestrictions(
        "booking",
        {},
        { payment_links: true },
        "pro",
      );
      expect(modules.payment_links).toBe(true);
    });

    it("permite advanced_analytics habilitado", () => {
      const modules = computeModulesWithPlanRestrictions(
        "food",
        {},
        { advanced_analytics: true },
        "pro",
      );
      expect(modules.advanced_analytics).toBe(true);
    });

    it("permite loyalty_program habilitado (Pro-only, no enterprise-only)", () => {
      // loyalty_program es Pro+ — disponible en Pro, no solo en Enterprise
      const modules = computeModulesWithPlanRestrictions(
        "retail",
        { loyalty_program: true },
        {},
        "pro",
      );
      expect(modules.loyalty_program).toBe(true);
    });

    it("permite coupons_discounts habilitado en Pro", () => {
      const modules = computeModulesWithPlanRestrictions(
        "food",
        { coupons_discounts: true },
        {},
        "pro",
      );
      expect(modules.coupons_discounts).toBe(true);
    });
  });

  describe("plan enterprise", () => {
    it("permite todos los módulos incluyendo loyalty_program y coupons", () => {
      const modules = computeModulesWithPlanRestrictions(
        "retail",
        { loyalty_program: true, coupons_discounts: true },
        {},
        "enterprise",
      );
      expect(modules.loyalty_program).toBe(true);
      expect(modules.coupons_discounts).toBe(true);
    });
  });

  describe("consistencia con PLAN_MODULE_MAP", () => {
    it("todos los módulos falsos en starter quedan falsos independientemente del wizard", () => {
      const starterFalse = Object.entries(PLAN_MODULE_MAP["starter"])
        .filter(([, v]) => v === false)
        .map(([k]) => k);

      // Wizard activa todos explícitamente
      const allTrue = Object.fromEntries(starterFalse.map((k) => [k, true]));

      const modules = computeModulesWithPlanRestrictions(
        "food",
        allTrue,
        allTrue,
        "starter",
      );

      for (const key of starterFalse) {
        expect(modules[key]).toBe(false);
      }
    });
  });
});
