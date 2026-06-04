import { PLAN_MODULE_MAP } from "@bia/types";

/**
 * Tests del método changePlan de TenantService.
 *
 * Valida que al cambiar de plan se generen exactamente los $set correctos
 * para modules.* según el PLAN_MODULE_MAP, sin necesidad de montar NestJS completo.
 *
 * Pro-only (false en starter, true en pro+):
 *   qr_pages, advanced_analytics, delivery_zones, loyalty_program, finance_documents,
 *   quotation_builder, coupons_discounts
 *
 * Starter-available (true desde starter):
 *   kitchen_kds, product_modifiers, product_variants, inventory_tracking, booking,
 *   staff_management, quotes_estimates, labor_pricing, payment_links, scheduled_orders
 */
describe("TenantService.changePlan — lógica de $set", () => {
  /** Replica la lógica de changePlan para extraer el $set generado */
  function buildSetPayload(
    plan: "starter" | "pro" | "enterprise",
  ): Record<string, unknown> {
    const moduleOverrides = PLAN_MODULE_MAP[plan] ?? {};
    return {
      plan,
      ...Object.fromEntries(
        Object.entries(moduleOverrides).map(([k, v]) => [`modules.${k}`, v]),
      ),
    };
  }

  describe("plan starter", () => {
    const payload = buildSetPayload("starter");

    it("setea plan = starter", () => {
      expect(payload.plan).toBe("starter");
    });

    it("deshabilita finance_documents (Pro-only)", () => {
      expect(payload["modules.finance_documents"]).toBe(false);
    });

    it("deshabilita advanced_analytics (Pro-only)", () => {
      expect(payload["modules.advanced_analytics"]).toBe(false);
    });

    it("deshabilita quotation_builder (Pro-only)", () => {
      expect(payload["modules.quotation_builder"]).toBe(false);
    });

    it("deshabilita loyalty_program (Pro-only)", () => {
      expect(payload["modules.loyalty_program"]).toBe(false);
    });

    it("deshabilita coupons_discounts (Pro-only)", () => {
      expect(payload["modules.coupons_discounts"]).toBe(false);
    });

    it("deshabilita qr_pages (Pro-only)", () => {
      // qr_pages es un canal extra de venta — Pro, no operación básica
      expect(payload["modules.qr_pages"]).toBe(false);
    });

    it("habilita product_variants (Starter — core para retail)", () => {
      // product_variants NO es Pro-only: retail no puede vender sin tallas/colores
      expect(payload["modules.product_variants"]).toBe(true);
    });

    it("habilita payment_links (Starter — core para booking/service)", () => {
      // payment_links NO es Pro-only: booking y service lo usan para señas/anticipos
      expect(payload["modules.payment_links"]).toBe(true);
    });

    it("habilita kitchen_kds", () => {
      expect(payload["modules.kitchen_kds"]).toBe(true);
    });

    it("habilita booking", () => {
      expect(payload["modules.booking"]).toBe(true);
    });

    it("habilita quotes_estimates y labor_pricing", () => {
      expect(payload["modules.quotes_estimates"]).toBe(true);
      expect(payload["modules.labor_pricing"]).toBe(true);
    });
  });

  describe("plan pro", () => {
    const payload = buildSetPayload("pro");

    it("setea plan = pro", () => {
      expect(payload.plan).toBe("pro");
    });

    it("habilita finance_documents", () => {
      expect(payload["modules.finance_documents"]).toBe(true);
    });

    it("habilita advanced_analytics", () => {
      expect(payload["modules.advanced_analytics"]).toBe(true);
    });

    it("habilita quotation_builder", () => {
      expect(payload["modules.quotation_builder"]).toBe(true);
    });

    it("habilita loyalty_program (Pro+, no enterprise-only)", () => {
      expect(payload["modules.loyalty_program"]).toBe(true);
    });

    it("habilita coupons_discounts (Pro+)", () => {
      expect(payload["modules.coupons_discounts"]).toBe(true);
    });

    it("habilita qr_pages (Pro+)", () => {
      expect(payload["modules.qr_pages"]).toBe(true);
    });

    it("product_variants sigue habilitado en Pro (viene desde Starter)", () => {
      expect(payload["modules.product_variants"]).toBe(true);
    });

    it("payment_links sigue habilitado en Pro", () => {
      expect(payload["modules.payment_links"]).toBe(true);
    });
  });

  describe("plan enterprise", () => {
    const payload = buildSetPayload("enterprise");

    it("setea plan = enterprise", () => {
      expect(payload.plan).toBe("enterprise");
    });

    it("habilita loyalty_program", () => {
      expect(payload["modules.loyalty_program"]).toBe(true);
    });

    it("habilita coupons_discounts", () => {
      expect(payload["modules.coupons_discounts"]).toBe(true);
    });
  });

  describe("upgrade / downgrade consistency", () => {
    it("upgrade starter→pro habilita exactamente los módulos Pro-only", () => {
      const proOnlyModules = [
        "qr_pages",
        "advanced_analytics",
        "delivery_zones",
        "loyalty_program",
        "finance_documents",
        "quotation_builder",
        "coupons_discounts",
      ];
      const starterPayload = buildSetPayload("starter");
      const proPayload = buildSetPayload("pro");

      for (const mod of proOnlyModules) {
        expect(starterPayload[`modules.${mod}`]).toBe(false);
        expect(proPayload[`modules.${mod}`]).toBe(true);
      }
    });

    it("payment_links permanece habilitado tanto en starter como en pro", () => {
      const starterPayload = buildSetPayload("starter");
      const proPayload = buildSetPayload("pro");
      expect(starterPayload["modules.payment_links"]).toBe(true);
      expect(proPayload["modules.payment_links"]).toBe(true);
    });

    it("downgrade pro→starter deshabilita los módulos Pro-only", () => {
      const proPayload = buildSetPayload("pro");
      const starterPayload = buildSetPayload("starter");

      // finance_documents: true en pro → false en starter
      expect(proPayload["modules.finance_documents"]).toBe(true);
      expect(starterPayload["modules.finance_documents"]).toBe(false);

      // loyalty_program: true en pro → false en starter
      expect(proPayload["modules.loyalty_program"]).toBe(true);
      expect(starterPayload["modules.loyalty_program"]).toBe(false);
    });

    it("pro es superconjunto de starter (no downgrade silencioso)", () => {
      const starterPayload = buildSetPayload("starter");
      const proPayload = buildSetPayload("pro");

      for (const [key, val] of Object.entries(starterPayload)) {
        if (key.startsWith("modules.") && val === true) {
          expect(proPayload[key]).toBe(true);
        }
      }
    });

    it("enterprise es superconjunto de pro (no downgrade silencioso)", () => {
      const proPayload = buildSetPayload("pro");
      const enterprisePayload = buildSetPayload("enterprise");

      for (const [key, val] of Object.entries(proPayload)) {
        if (key.startsWith("modules.") && val === true) {
          expect(enterprisePayload[key]).toBe(true);
        }
      }
    });
  });
});
