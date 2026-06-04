import type { BusinessType, TenantModules } from "@foodorder/types";

export interface TemplateProduct {
  name: string;
  description?: string;
  price: number; // USD (invariante del repo)
  category: string; // matchea con TemplateCategory.name
  imageUrl?: string;
  durationMin?: number; // duración del servicio (para bookings/services)
  type?: "physical" | "prepared" | "service" | "labor"; // default: 'prepared' (MenuService)
}

export interface TemplateCategory {
  name: string;
  order: number;
}

export interface TemplateDefinition {
  id: string; // ej. "restaurant-qr"
  archetype: BusinessType;
  label: string;
  description: string;
  categories: TemplateCategory[];
  products: TemplateProduct[];
  defaultModules: Partial<TenantModules>;
}

export interface TemplateSummary {
  id: string;
  archetype: BusinessType;
  label: string;
  description: string;
  categoriesCount: number;
  productsCount: number;
}
