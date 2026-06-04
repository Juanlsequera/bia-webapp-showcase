import { FOOD_TEMPLATES } from "./food.templates";
import { RETAIL_TEMPLATES } from "./retail.templates";
import { BOOKING_TEMPLATES } from "./booking.templates";
import { SERVICE_TEMPLATES } from "./service.templates";
import type { TemplateDefinition, TemplateSummary } from "./types";

/**
 * Todos los templates disponibles, organizados por archetype.
 * Incluye templates en blanco para cada tipo de negocio.
 */
const ALL_TEMPLATES: TemplateDefinition[] = [
  ...FOOD_TEMPLATES,
  ...RETAIL_TEMPLATES,
  ...BOOKING_TEMPLATES,
  ...SERVICE_TEMPLATES,
];

/**
 * Obtener todos los templates disponibles.
 */
export function getAllTemplates(): TemplateDefinition[] {
  return ALL_TEMPLATES;
}

/**
 * Obtener un template por ID.
 * @throws Error si el template no existe
 */
export function getTemplateById(id: string): TemplateDefinition {
  const template = ALL_TEMPLATES.find((t) => t.id === id);
  if (!template) {
    throw new Error(`Template with id "${id}" not found`);
  }
  return template;
}

/**
 * Obtener templates por archetype.
 */
export function getTemplatesByArchetype(
  archetype: string,
): TemplateDefinition[] {
  return ALL_TEMPLATES.filter((t) => t.archetype === archetype);
}

/**
 * Convertir un template a formato summary (para listados).
 */
export function toTemplateSummary(
  template: TemplateDefinition,
): TemplateSummary {
  return {
    id: template.id,
    archetype: template.archetype,
    label: template.label,
    description: template.description,
    categoriesCount: template.categories.length,
    productsCount: template.products.length,
  };
}

/**
 * Obtener resumen de todos los templates.
 */
export function getAllTemplatesSummary(): TemplateSummary[] {
  return ALL_TEMPLATES.map(toTemplateSummary);
}

// Re-export tipos para conveniencia
export type {
  TemplateDefinition,
  TemplateCategory,
  TemplateProduct,
  TemplateSummary,
} from "./types";
