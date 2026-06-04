import type { TenantModules } from "./tenant.types";

/**
 * Restricciones de módulos por plan — fuente única de verdad de qué puede habilitar
 * cada plan. Es el override FINAL en el cálculo de módulos al configurar un tenant:
 *
 *   modules = {
 *     ...getDefaultModulesForArchetype(archetype),
 *     ...template.defaultModules,
 *     ...explicitModules,
 *     ...planRestrictions,   ← el plan siempre gana
 *   };
 *
 * Semántica:
 *   true  → el plan PERMITE este módulo (el usuario puede activarlo / viene recomendado)
 *   false → el plan BLOQUEA este módulo (locked en UI, siempre off)
 *
 * Pro-only modules (false en starter, true en pro+):
 *   advanced_analytics, delivery_zones, loyalty_program,
 *   finance_documents, quotation_builder, coupons_discounts, product_variants
 *
 * Disponibles en Starter:
 *   kitchen_kds, product_modifiers, inventory_tracking, booking, staff_management,
 *   quotes_estimates, labor_pricing, payment_links, qr_pages, scheduled_orders
 */
export const PLAN_MODULE_MAP: Record<string, Partial<TenantModules>> = {
  starter: {
    // ── Core de cada arquetipo — disponibles en Starter ─────────────────────
    kitchen_kds: true,       // food: panel cocina
    product_modifiers: true, // food: modificadores/extras
    inventory_tracking: true,// retail: control de stock
    booking: true,           // booking: sistema de turnos
    staff_management: true,  // booking/service: agenda por profesional
    quotes_estimates: true,  // service: solicitudes de trabajo
    labor_pricing: true,     // service: cobro por horas
    payment_links: true,     // booking/service: links de pago para señas y anticipos
    qr_pages: true,          // todos: páginas de cobro permanentes
    scheduled_orders: true,  // retail: retiro/entrega programada

    // ── Pro-only — bloqueados en Starter ────────────────────────────────────
    advanced_analytics: false,
    delivery_zones: false,
    loyalty_program: false,
    finance_documents: false,
    quotation_builder: false,
    coupons_discounts: false,
    product_variants: false,
  },

  pro: {
    // ── Todo lo de Starter ───────────────────────────────────────────────────
    kitchen_kds: true,
    product_modifiers: true,
    inventory_tracking: true,
    booking: true,
    staff_management: true,
    quotes_estimates: true,
    labor_pricing: true,
    payment_links: true,
    qr_pages: true,
    scheduled_orders: true,

    // ── Pro desbloquea estas features ───────────────────────────────────────
    advanced_analytics: true,
    delivery_zones: true,
    loyalty_program: true,
    finance_documents: true,
    quotation_builder: true,
    coupons_discounts: true,
    product_variants: true,
  },

  enterprise: {
    // ── Todo habilitado ──────────────────────────────────────────────────────
    kitchen_kds: true,
    product_modifiers: true,
    inventory_tracking: true,
    booking: true,
    staff_management: true,
    quotes_estimates: true,
    labor_pricing: true,
    payment_links: true,
    qr_pages: true,
    scheduled_orders: true,
    advanced_analytics: true,
    delivery_zones: true,
    loyalty_program: true,
    finance_documents: true,
    quotation_builder: true,
    coupons_discounts: true,
    product_variants: true,
  },
};
