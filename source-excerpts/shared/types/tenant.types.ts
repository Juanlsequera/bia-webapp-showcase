export interface SocialLinks {
  whatsapp?: string;
  instagram?: string;
  tiktok?: string;
}

export interface ThemeColors {
  primary: string;
  secondary: string;
  accent: string;
  font_heading?: string;
  font_body?: string;
  border_radius?: "sharp" | "default" | "rounded";
  /** Eslogan corto visible debajo del nombre en el hero del cliente. */
  tagline?: string;
  /** Estilo del hero del cliente. 'brand' = fondo color primario. 'cover' = foto de portada. */
  hero_layout?: "brand" | "cover";
  /** Modo oscuro para la UI del cliente (fondo oscuro, texto claro). */
  dark_mode?: boolean;
  /** Layout del catálogo de productos. 'grid' = tarjetas 2 col. 'list' = filas horizontales. */
  menu_layout?: "grid" | "list";
}

export type TenantPlan = "starter" | "pro" | "enterprise";

/**
 * Horario de atención del negocio.
 * - openHour / closeHour: hora local en formato 0-23.
 * - closedDays: días de la semana cerrados (0=Dom, 1=Lun … 6=Sab). [] = abre todos los días.
 * - timezone: zona horaria IANA. Default 'America/Caracas' (UTC-4, sin DST).
 * - forceOpen: override manual — true = forzar abierto sin importar el horario.
 * - forceClosed: override manual — true = forzar cerrado sin importar el horario.
 */
export interface TenantSchedule {
  openHour: number; // ej: 8  = abre a las 8:00am
  closeHour: number; // ej: 22 = cierra a las 10:00pm
  closedDays: number[]; // ej: [0] = cierra los domingos
  timezone: string; // ej: 'America/Caracas'
  forceOpen: boolean; // admin puede forzar apertura fuera de horario
  forceClosed: boolean; // admin puede forzar cierre dentro de horario
}

// Datos de PagoMóvil configurados por el negocio (receptor de la transferencia)
// ─── PagoMóvil legacy (mantener compatibilidad) ───────────────────────────────
/** @deprecated Usar payment_methods.pagomovil en su lugar */
export interface PagoMovilInfo {
  bank: string; // ej: "Banesco"
  rif: string; // RIF o cédula del receptor
  phone: string; // teléfono registrado en el banco
  accountHolder: string; // nombre del titular
}

// Cuenta bancaria multi-cuenta — reemplaza a PagoMovilInfo
export interface BankAccount {
  _id: string;
  bank: string; // ej: "Banesco"
  phone: string; // teléfono registrado en PagoMóvil
  rif: string; // RIF o cédula del titular
  accountHolder: string; // nombre del titular
  isDefault: boolean; // la que se muestra por defecto al cliente
  isActive: boolean; // permite desactivar sin borrar
  /**
   * PMV.3 — Código SUDEBAN del banco (4 dígitos). Ej: "0134" = Banesco.
   * Necesario para generar el payload QR EMVCo. Opcional — si no está
   * configurado el QR EMVCo no se muestra (degradación silenciosa).
   */
  bankCode?: string;
  /**
   * PMV.3 — URL pública del QR S7B subido por el tenant desde la app de
   * su banco. Cuando está presente, la PagomovilPage lo muestra para que
   * el cliente lo escanee con su app bancaria.
   */
  qrImageUrl?: string | null;
  /**
   * PMV.3 — Texto crudo decodificado del QR S7B (EMVCo TLV, JSON, URL,
   * etc.). Útil para auditar consistencia con los campos manuales y para
   * iterar el parser en el futuro. No es secreto — el QR es público.
   */
  qrRawPayload?: string | null;
}

// DTO para crear/editar una cuenta bancaria
export interface BankAccountDto {
  bank: string;
  phone: string;
  rif: string;
  accountHolder: string;
  isDefault?: boolean;
  isActive?: boolean;
  /** PMV.3 — Código SUDEBAN (4 dígitos). Requerido para QR EMVCo. Ej: "0134" = Banesco */
  bankCode?: string;
}

/**
 * Modos de pedido habilitados por el tenant.
 * dine_in: pedidos en mesa (default).
 * takeaway: para llevar.
 * delivery: a domicilio (UI diferida, schema listo desde P2.17).
 */
export interface OrderModes {
  dine_in: boolean;
  takeaway: boolean;
  delivery: boolean;
}

// Doc completo del tenant (uso interno admin + superadmin)
export interface Tenant {
  _id: string;
  slug: string;
  name: string;
  logo_url: string | null;
  cover_url?: string | null;
  theme: ThemeColors;
  pagomovil: PagoMovilInfo | null; // legacy — se migra a bankAccounts
  bankAccounts: BankAccount[];
  transferAccounts: TransferAccount[];
  zelleAccounts: ZelleAccount[];
  plan: TenantPlan;
  active: boolean;
  onboarded: boolean;
  autoAcceptOrders: boolean;
  orderModes: OrderModes;
  /** Horario de atención. null = sin horario configurado = siempre abierto. */
  schedule: TenantSchedule | null;
  // Campos nuevos multi-arquetipo
  business_types?: BusinessType[];
  theme_v2?: ThemeColors;
  modules?: TenantModules;
  payment_methods_v2?: TenantPaymentMethods;
  checkout_fields?: TenantCheckoutFields;
  contact?: SocialLinks;
  template_id?: string | null; // ej: "restaurant-qr", "pizzeria", etc.
  active_config_id?: string | null; // ref a TenantConfig._id
  config_version?: number; // versión actual de la config
  config_hash?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Business Archetypes ──────────────────────────────────────────────────────
export type BusinessType = "food" | "retail" | "booking" | "service";

/**
 * LayoutArchetype extiende BusinessType con el arquetipo híbrido.
 * hybrid = retail + servicio técnico en la misma interfaz (ej: tienda de computación).
 */
export type LayoutArchetype = BusinessType | "hybrid";

// ─── Modules ──────────────────────────────────────────────────────────────────
export interface TenantModules {
  kitchen_kds: boolean;
  booking: boolean;
  product_variants: boolean;
  product_modifiers: boolean;
  inventory_tracking: boolean;
  delivery_zones: boolean;
  scheduled_orders: boolean;
  labor_pricing: boolean;
  quotes_estimates: boolean;
  staff_management: boolean;
  loyalty_program: boolean;
  coupons_discounts: boolean;
  /** Links de pago compartibles por WhatsApp/email para cobros fuera del flujo de pedido. */
  payment_links: boolean;
  /** Generador de presupuestos/cotizaciones en PDF con desglose de IVA. */
  quotation_builder: boolean;
  /** Analytics avanzado: tiempos de cocina, distribución por hora, horas pico. Solo Plan Pro. */
  advanced_analytics?: boolean;
  /**
   * Módulo de documentos financieros — captura de gastos/ingresos con extracción LLM.
   *
   * LÍMITE DE SCOPE (deliberado — esto es un tracker, NO un ERP):
   *   ✅ DENTRO: captura de gasto con foto + OCR (LLM extrae monto/proveedor/fecha),
   *      lista de gastos del período, dashboard simple ingresos-vs-gastos, export CSV.
   *   ❌ FUERA (= otro producto): P&L formal con depreciaciones, cuentas por pagar/cobrar,
   *      declaraciones fiscales (SENIAT/IVA), conciliación bancaria, balance general.
   * La línea es: "información útil para el dueño" (BIA) vs "herramienta para el contador" (ERP).
   */
  finance_documents: boolean;
  /**
   * Páginas de cobro permanentes asociadas a un QR impreso.
   * El QR nunca cambia; el admin edita monto/productos sin reimprimir.
   * Feature estándar: activado por defecto en todos los arquetipos y planes.
   */
  qr_pages: boolean;
}

/**
 * Baseline de módulos por arquetipo — fuente única de verdad de qué módulos
 * aplican a cada vertical y cuáles vienen activados por defecto.
 *
 * Semántica de cada entrada:
 *   - clave con `true`   → módulo RECOMENDADO (viene activado por defecto)
 *   - clave con `false`  → módulo APLICABLE pero opcional (apagado por defecto)
 *   - clave AUSENTE      → módulo NO APLICA al arquetipo (se oculta en la UI de config)
 *
 * Consumido por:
 *   - `ModulesTab` (apps/web) para clasificar/ocultar toggles según el arquetipo del tenant
 *   - `getTenantCapabilities` (apps/web/src/lib/tenant.ts) para derivar capacidades de UI
 *   - templates "en blanco" de onboarding como default cuando no hay catálogo seed
 *
 * Los templates nombrados (restaurant-qr, pizzeria, etc.) pueden sobrescribir este
 * baseline con `defaultModules` propios para afinar por caso de uso.
 */
export const ARCHETYPE_MODULE_DEFAULTS: Record<
  LayoutArchetype,
  Partial<TenantModules>
> = {
  /**
   * FOOD — restaurantes, cafés, fast food.
   *
   * Core siempre activo (no son módulos): catálogo, carrito, órdenes, pago móvil,
   * caja, tasa BCV, analytics básico.
   *
   * Módulos recomendados: cocina (KDS), modificadores.
   * Módulos opcionales: delivery, variantes, inventario, cupones, puntos, finanzas.
   * Ausentes (no aplican): reservas, staff, cotizaciones, mano de obra,
   *   links de pago, presupuesto PDF, pedidos programados.
   */
  food: {
    kitchen_kds: true,        // recomendado: panel cocina en tiempo real
    product_modifiers: true,  // recomendado: extras/modificadores (sin cebolla, extra queso)
    qr_pages: true,           // recomendado: páginas de cobro permanentes
    delivery_zones: false,    // opcional — Pro: zonas con costo de envío
    product_variants: false,  // opcional — Pro: variantes (tamaño chico/grande/etc)
    inventory_tracking: false,// opcional: control de stock
    coupons_discounts: false, // opcional — Pro: códigos de descuento
    loyalty_program: false,   // opcional — Pro: programa de puntos
    finance_documents: false, // opcional — Pro: captura gastos/ingresos con OCR
  },

  /**
   * RETAIL — ropa, agua, repuestos, tiendas.
   *
   * Módulos recomendados: variantes (tallas/colores), inventario, QR pages.
   * Módulos opcionales: delivery, pedidos programados, cupones, puntos, links de pago, finanzas.
   * Ausentes: cocina, modificadores, reservas, staff, cotizaciones, mano de obra, presupuesto PDF.
   */
  retail: {
    product_variants: true,   // recomendado — Pro: variantes (talla, color, modelo)
    inventory_tracking: true, // recomendado: control de stock
    qr_pages: true,           // recomendado: páginas de cobro permanentes
    scheduled_orders: false,  // opcional: permitir retiro/delivery programado
    delivery_zones: false,    // opcional — Pro: zonas de envío con costo
    coupons_discounts: false, // opcional — Pro: códigos de descuento
    loyalty_program: false,   // opcional — Pro: programa de puntos
    payment_links: false,     // opcional: links para pedidos especiales
    finance_documents: false, // opcional — Pro: captura gastos/ingresos con OCR
  },

  /**
   * BOOKING — peluquerías, spas, médicos, clínicas.
   *
   * Módulos recomendados: sistema de reservas, links de pago (señas/anticipos), QR pages.
   * Módulos opcionales: gestión de profesionales/staff, puntos, finanzas.
   * Ausentes: cocina, modificadores, variantes, inventario, delivery, cotizaciones, mano de obra,
   *   presupuesto PDF, pedidos programados, cupones.
   */
  booking: {
    booking: true,            // recomendado: flujo de turnos online con fecha y hora
    payment_links: true,      // recomendado: links para cobrar señas/anticipos
    qr_pages: true,           // recomendado: páginas de cobro permanentes
    staff_management: false,  // opcional: agenda por profesional (peluquero A vs B)
    loyalty_program: false,   // opcional — Pro: programa de puntos
    finance_documents: false, // opcional — Pro: captura gastos/ingresos con OCR
  },

  /**
   * SERVICE — técnicos, plomeros, consultores, constructoras.
   *
   * Módulos recomendados: cotizaciones, mano de obra, links de pago, presupuesto PDF, QR pages.
   * Módulos opcionales: staff, inventario de repuestos, finanzas.
   * Ausentes: cocina, modificadores, variantes, delivery, reservas, cupones, puntos, programados.
   */
  service: {
    quotes_estimates: true,   // recomendado: solicitudes de trabajo con flujo de aprobación
    labor_pricing: true,      // recomendado: cobro por horas de trabajo
    payment_links: true,      // recomendado: links para cobrar anticipos y saldo
    quotation_builder: true,  // recomendado — Pro: presupuestos PDF formales con IVA
    qr_pages: true,           // recomendado: páginas de cobro permanentes
    staff_management: false,  // opcional: gestión de técnicos con agenda
    inventory_tracking: false,// opcional: control de repuestos y materiales
    finance_documents: false, // opcional — Pro: captura gastos/ingresos con OCR
  },

  /**
   * HYBRID — negocios que combinan venta de productos físicos con servicios técnicos.
   * Ej: tienda de computación que vende hardware y también repara equipos.
   *
   * Módulos recomendados: cotizaciones, mano de obra, links de pago, QR pages.
   * Módulos opcionales: variantes, inventario de repuestos, staff, finanzas.
   */
  hybrid: {
    quotes_estimates: true,   // recomendado: solicitudes de trabajo con flujo de aprobación
    labor_pricing: true,      // recomendado: cobro por horas de trabajo
    payment_links: true,      // recomendado: links para cobrar anticipos y saldo
    qr_pages: true,           // recomendado: páginas de cobro permanentes
    product_variants: false,  // opcional — Pro: variantes (modelo, capacidad, color)
    inventory_tracking: false,// opcional: control de repuestos y materiales
    finance_documents: false, // opcional — Pro: captura gastos/ingresos con OCR
  },
};

/** Devuelve una copia de los módulos por defecto para un arquetipo (incluye hybrid). */
export function getDefaultModulesForArchetype(
  archetype: LayoutArchetype,
): Partial<TenantModules> {
  return { ...ARCHETYPE_MODULE_DEFAULTS[archetype] };
}

// ─── Transfer Accounts ────────────────────────────────────────────────────────

export type TransferAccountSubtype = "national" | "international";

/** Cuenta bancaria para recibir transferencias (nacional o internacional). */
export interface TransferAccount {
  _id: string;
  subtype: TransferAccountSubtype;
  currency: "VES" | "USD";
  accountHolder: string;
  alias: string | null;
  isDefault: boolean;
  isActive: boolean;
  // Nacional
  bank?: string | null;
  accountNumber?: string | null;
  accountType?: "corriente" | "ahorro" | null;
  idNumber?: string | null;
  // Internacional (wire)
  bankName?: string | null;
  swift?: string | null;
  iban?: string | null;
  routingNumber?: string | null;
  bankAddress?: string | null;
}

export interface CreateTransferAccountDto {
  subtype: TransferAccountSubtype;
  currency: "VES" | "USD";
  accountHolder: string;
  alias?: string;
  isDefault?: boolean;
  bank?: string;
  accountNumber?: string;
  accountType?: "corriente" | "ahorro";
  idNumber?: string;
  bankName?: string;
  swift?: string;
  iban?: string;
  routingNumber?: string;
  bankAddress?: string;
}

export interface UpdateTransferAccountDto extends Partial<
  Omit<CreateTransferAccountDto, "subtype">
> {
  isActive?: boolean;
}

// ─── Zelle Accounts ───────────────────────────────────────────────────────────

export type ZelleContactType = "email" | "phone";

/** Cuenta Zelle del negocio para recibir pagos USD. */
export interface ZelleAccount {
  _id: string;
  contactType: ZelleContactType;
  contact: string;
  holderName: string;
  bankApp: string | null;
  alias: string | null;
  isDefault: boolean;
  isActive: boolean;
}

export interface CreateZelleAccountDto {
  contactType: ZelleContactType;
  contact: string;
  holderName: string;
  bankApp?: string;
  alias?: string;
  isDefault?: boolean;
}

export interface UpdateZelleAccountDto extends Partial<
  Omit<CreateZelleAccountDto, "contactType">
> {
  isActive?: boolean;
}

// ─── Payment Methods ──────────────────────────────────────────────────────────
export interface PaymentMethodConfig {
  enabled: boolean;
  bank?: string;
  phone?: string;
  id_number?: string;
  account_holder?: string;
  account_details?: string;
  provider?: string | null;
}

export interface TenantPaymentMethods {
  pagomovil: PaymentMethodConfig;
  cash: PaymentMethodConfig;
  bank_transfer: PaymentMethodConfig;
  card_online: PaymentMethodConfig;
}

// ─── Checkout Fields ──────────────────────────────────────────────────────────
export interface CheckoutFieldConfig {
  enabled: boolean;
  required?: boolean;
  label?: string;
}

export interface TenantCheckoutFields {
  delivery_address: CheckoutFieldConfig;
  table_number: CheckoutFieldConfig;
  notes: CheckoutFieldConfig;
  scheduled_datetime: CheckoutFieldConfig;
  reference_person: CheckoutFieldConfig;
  dni_cedula: CheckoutFieldConfig;
}

// ─── Upsell config ────────────────────────────────────────────────────────────

/**
 * Configuración del upsell "¿Lo hacés combo?" — persiste en tenant.upsell.
 * En el MenuResponse se expone como `upsell` con los add-ons ya resueltos.
 */
export interface TenantUpsell {
  enabled: boolean;
  addOnProductIds: string[];
  bundleExtraPrice: number;
}

// Lo que recibe el cliente final sin auth: sólo campos públicos
export interface TenantPublic {
  slug: string;
  name: string;
  logo_url: string | null;
  cover_url?: string | null;
  // Legacy fields
  theme: ThemeColors;
  pagomovil: PagoMovilInfo | null;
  bankAccounts: BankAccount[];
  transferAccounts: TransferAccount[];
  zelleAccounts: ZelleAccount[];
  city?: string;
  usdRate: import("./bcv.types").UsdRate;
  isOpen: boolean;
  schedule: TenantSchedule | null;
  orderModes: OrderModes;
  // Nuevos campos multi-arquetipo
  business_types: BusinessType[];
  modules: TenantModules;
  payment_methods: TenantPaymentMethods;
  checkout_fields: TenantCheckoutFields;
  config_hash: string;
  contact?: SocialLinks;
  booking_settings?: {
    deposit_pct: number;
    notify_email: boolean;
    notify_whatsapp: boolean;
  };
  /** Config de upsell — solo expone si enabled=true desde el admin. */
  upsell?: TenantUpsell;
}

// DTO para PATCH /tenants/me — todo opcional
export interface UpdateTenantDto {
  name?: string;
  logo_url?: string | null;
  theme?: Partial<ThemeColors>;
  pagomovil?: PagoMovilInfo | null;
  autoAcceptOrders?: boolean;
  schedule?: TenantSchedule | null;
  orderModes?: Partial<OrderModes>;
  contact?: SocialLinks;
}

// DTO para POST /tenants (superadmin): crea Tenant + usuario admin inicial
export interface CreateTenantDto {
  tenantName: string;
  tenantSlug: string;
  adminEmail: string;
  adminPassword: string;
}

// Respuesta al crear un tenant nuevo (sin exponer el password)
export interface CreateTenantResponse {
  tenant: Tenant;
  admin: {
    _id: string;
    email: string;
    role: string;
    tenantId: string;
  };
}

// ─── Onboarding / Alta de Negocio ─────────────────────────────────────────────
/** DTO para el wizard de alta de negocio (superadmin configura un tenant existente) */
export interface ConfigureTenantDto {
  plan: TenantPlan;
  business_types: BusinessType[];
  template_id: string; // ej: "restaurant-qr", "pizzeria", "barbershop", etc.
  modules: Partial<TenantModules>;
}

/** Respuesta al configurar un tenant (PATCH /tenants/:id/configure) */
export interface ConfigureTenantResponse {
  tenant: Tenant;
  config_id: string; // ObjectId del TenantConfig creado
  seeded_categories: number; // cuántas categorías se crearon del template
  seeded_products: number; // cuántos productos/servicios se crearon del template
}
