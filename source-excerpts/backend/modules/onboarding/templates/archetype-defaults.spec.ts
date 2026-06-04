import {
  ARCHETYPE_MODULE_DEFAULTS,
  getDefaultModulesForArchetype,
  type BusinessType,
} from "@foodorder/types";
import { getAllTemplates } from "./index";

/**
 * Guard de regresión para la fuente única de verdad de módulos por arquetipo.
 * Protege Mejora 1 (ARCHETYPE_MODULE_DEFAULTS) + el refactor de templates "en blanco".
 */
describe("ARCHETYPE_MODULE_DEFAULTS", () => {
  it("marca como recomendados los módulos core de cada arquetipo", () => {
    // food
    expect(ARCHETYPE_MODULE_DEFAULTS.food.kitchen_kds).toBe(true);
    expect(ARCHETYPE_MODULE_DEFAULTS.food.product_modifiers).toBe(true);
    // retail
    expect(ARCHETYPE_MODULE_DEFAULTS.retail.inventory_tracking).toBe(true);
    // booking
    expect(ARCHETYPE_MODULE_DEFAULTS.booking.booking).toBe(true);
    expect(ARCHETYPE_MODULE_DEFAULTS.booking.payment_links).toBe(true);
    // service
    expect(ARCHETYPE_MODULE_DEFAULTS.service.quotes_estimates).toBe(true);
    expect(ARCHETYPE_MODULE_DEFAULTS.service.labor_pricing).toBe(true);
    expect(ARCHETYPE_MODULE_DEFAULTS.service.payment_links).toBe(true);
  });

  it("marca como opcionales (false) los módulos que aplican pero no son core", () => {
    // staff_management es opcional en booking y service — no es recomendado
    expect(ARCHETYPE_MODULE_DEFAULTS.booking.staff_management).toBe(false);
    expect(ARCHETYPE_MODULE_DEFAULTS.service.staff_management).toBe(false);
    // finance_documents aplica a todos los arquetipos como opcional
    expect(ARCHETYPE_MODULE_DEFAULTS.food.finance_documents).toBe(false);
    expect(ARCHETYPE_MODULE_DEFAULTS.retail.finance_documents).toBe(false);
    expect(ARCHETYPE_MODULE_DEFAULTS.booking.finance_documents).toBe(false);
    expect(ARCHETYPE_MODULE_DEFAULTS.service.finance_documents).toBe(false);
  });

  it("oculta (omite) los módulos que no aplican al arquetipo", () => {
    // food no usa reservas, cotizaciones, mano de obra, staff, links de pago ni presupuestos
    expect("booking" in ARCHETYPE_MODULE_DEFAULTS.food).toBe(false);
    expect("quotes_estimates" in ARCHETYPE_MODULE_DEFAULTS.food).toBe(false);
    expect("staff_management" in ARCHETYPE_MODULE_DEFAULTS.food).toBe(false);
    expect("payment_links" in ARCHETYPE_MODULE_DEFAULTS.food).toBe(false);
    expect("quotation_builder" in ARCHETYPE_MODULE_DEFAULTS.food).toBe(false);
    expect("scheduled_orders" in ARCHETYPE_MODULE_DEFAULTS.food).toBe(false);
    // retail no usa cocina ni modificadores (son food-specific)
    expect("kitchen_kds" in ARCHETYPE_MODULE_DEFAULTS.retail).toBe(false);
    expect("booking" in ARCHETYPE_MODULE_DEFAULTS.retail).toBe(false);
    expect("product_modifiers" in ARCHETYPE_MODULE_DEFAULTS.retail).toBe(false);
    expect("quotation_builder" in ARCHETYPE_MODULE_DEFAULTS.retail).toBe(false);
    // booking no usa cocina, modificadores ni cotizaciones service
    expect("kitchen_kds" in ARCHETYPE_MODULE_DEFAULTS.booking).toBe(false);
    expect("product_modifiers" in ARCHETYPE_MODULE_DEFAULTS.booking).toBe(false);
    expect("quotes_estimates" in ARCHETYPE_MODULE_DEFAULTS.booking).toBe(false);
    expect("quotation_builder" in ARCHETYPE_MODULE_DEFAULTS.booking).toBe(false);
    // service no usa cocina ni reservas booking
    expect("kitchen_kds" in ARCHETYPE_MODULE_DEFAULTS.service).toBe(false);
    expect("booking" in ARCHETYPE_MODULE_DEFAULTS.service).toBe(false);
    expect("product_modifiers" in ARCHETYPE_MODULE_DEFAULTS.service).toBe(false);
  });

  it("getDefaultModulesForArchetype devuelve una copia (no la referencia interna)", () => {
    const a = getDefaultModulesForArchetype("food");
    const b = getDefaultModulesForArchetype("food");
    expect(a).toEqual(b);
    expect(a).not.toBe(ARCHETYPE_MODULE_DEFAULTS.food);
  });
});

describe('templates "en blanco" derivan del baseline del arquetipo', () => {
  const blanks = getAllTemplates().filter((t) => t.id.endsWith("-en-blanco"));

  it("hay un template en blanco por cada arquetipo", () => {
    const archetypes = new Set(blanks.map((t) => t.archetype));
    expect(archetypes).toEqual(
      new Set<BusinessType>(["food", "retail", "booking", "service"]),
    );
  });

  it.each(["food", "retail", "booking", "service"] as BusinessType[])(
    "%s en blanco usa exactamente getDefaultModulesForArchetype",
    (archetype) => {
      const blank = blanks.find((t) => t.archetype === archetype)!;
      expect(blank.defaultModules).toEqual(
        getDefaultModulesForArchetype(archetype),
      );
    },
  );
});
