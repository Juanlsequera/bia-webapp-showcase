import {
  Injectable,
  NotFoundException,
  InternalServerErrorException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import * as crypto from "crypto";

import { Tenant, type TenantDocument } from "./schemas/tenant.schema";
import {
  TenantConfig,
  type TenantConfigDocument,
} from "./schemas/tenant-config.schema";
import { AppLogger } from "../logger/logger.service";

// ─── Config por defecto ────────────────────────────────────────────────────────
// Se usa como base para merge — el tenant recibe este objeto completo si no tiene
// aún ninguna versión de config guardada (por ejemplo en tenants legacy).

const DEFAULT_CONFIG: Record<string, unknown> = {
  branding: {
    showPoweredBy: true,
  },
  catalog: {
    itemNounSingular: "producto",
    itemNounPlural: "productos",
    enableCategories: true,
    enableImages: true,
    enableVariants: false,
    enableModifiers: false,
    enableInventory: false,
    enableDuration: false,
    enablePrepTime: false,
  },
  fulfillment: {
    modes: { dine_in: true, takeaway: true, delivery: false },
  },
  customerFields: {
    name: { enabled: true, required: true, label: "Nombre" },
    phone: { enabled: true, required: false, label: "Teléfono" },
    email: { enabled: false, required: false, label: "Email" },
    address: {
      enabled: false,
      required: false,
      label: "Dirección",
      askMap: false,
    },
    dni: { enabled: false, required: false, label: "Cédula" },
    notes: { enabled: true, required: false, label: "Notas" },
    custom: [],
  },
  payments: {
    providers: {
      cash: { enabled: true, label: "Efectivo" },
      bankTransfer: { enabled: false, label: "Transferencia", accounts: [] },
      pagomovil: {
        enabled: true,
        label: "PagoMóvil",
        requiresReceiptUpload: true,
      },
      stripe: { enabled: false },
      mercadopago: { enabled: false },
      paypal: { enabled: false },
      custom: [],
    },
    autoApprove: { cash: false, bankTransfer: false, pagomovil: false },
  },
  modules: {
    kitchen_kds: true,
    booking: false,
    product_variants: false,
    product_modifiers: false,
    inventory_tracking: false,
    delivery_zones: false,
    scheduled_orders: false,
    labor_pricing: false,
    quotes_estimates: false,
    staff_management: false,
    loyalty_program: false,
    coupons_discounts: false,
    payment_links: false,
  },
  labels: {},
};

// ─── Deep merge simple ─────────────────────────────────────────────────────────
// Evita dependencia de lodash en el backend. Solo se usa para plain objects.

function deepMerge(
  target: Record<string, unknown>,
  ...sources: Record<string, unknown>[]
): Record<string, unknown> {
  const result = { ...target };
  for (const source of sources) {
    for (const key of Object.keys(source)) {
      const sv = source[key];
      const tv = result[key];
      if (
        sv !== null &&
        typeof sv === "object" &&
        !Array.isArray(sv) &&
        tv !== null &&
        typeof tv === "object" &&
        !Array.isArray(tv)
      ) {
        result[key] = deepMerge(
          tv as Record<string, unknown>,
          sv as Record<string, unknown>,
        );
      } else {
        result[key] = sv;
      }
    }
  }
  return result;
}

@Injectable()
export class TenantConfigService {
  constructor(
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(TenantConfig.name)
    private tenantConfigModel: Model<TenantConfigDocument>,
    private readonly logger: AppLogger,
  ) {}

  // ─── getEffective ────────────────────────────────────────────────────────────

  /**
   * Devuelve la config efectiva del tenant: DEFAULT_CONFIG mergeada con
   * los campos M2 (branding, catalog, etc.) de la versión activa.
   *
   * Si el tenant no tiene aún una versión activa (legacy), devuelve los defaults
   * enriquecidos con los datos que sí existen en el doc Tenant (orderModes, etc.).
   */
  async getEffective(tenantId: string): Promise<Record<string, unknown>> {
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant) throw new NotFoundException("Tenant no encontrado");

    // Buscar la versión activa
    let storedConfig: Record<string, unknown> = {};
    if (tenant.active_config_id) {
      const cfg = (await this.tenantConfigModel
        .findById(tenant.active_config_id)
        .lean()) as Record<string, unknown> | null;
      if (cfg) {
        // Descartar metadatos de Mongoose/MongoDB para que NO se propaguen
        // al próximo snapshot. Si _id del doc anterior llega a ...next dentro
        // de create(), MongoDB lanza E11000 duplicate key en el segundo save.
        const MONGO_META = new Set([
          "_id",
          "__v",
          "tenant_id",
          "version",
          "is_active",
          "label",
          "changed_by",
          "config_hash",
          "createdAt",
          "updatedAt",
        ]);
        storedConfig = Object.fromEntries(
          Object.entries(cfg as Record<string, unknown>).filter(
            ([k]) => !MONGO_META.has(k),
          ),
        );
      }
    }

    // Construir overrides desde los campos legacy del Tenant (para tenants sin config aún)
    const legacyOverrides: Record<string, unknown> = {};
    if (tenant.orderModes) {
      // Eliminar _id del subdocumento orderModes — .lean() lo devuelve como buffer BSON crudo
      // y al propagarlo al snapshot contamina futuras lecturas con un _id no casteable.
      const cleanModes = Object.fromEntries(
        Object.entries(tenant.orderModes as Record<string, unknown>).filter(
          ([k]) => k !== "_id",
        ),
      );
      legacyOverrides.fulfillment = { modes: cleanModes };
    }
    if (tenant.modules && Object.keys(tenant.modules).length > 0) {
      // Eliminar _id que Mongoose agrega al subdocumento modules del Tenant.
      // Si se deja, deepMerge lo propaga a next.modules y contamina el snapshot.
      legacyOverrides.modules = Object.fromEntries(
        Object.entries(tenant.modules as Record<string, unknown>).filter(
          ([k]) => k !== "_id",
        ),
      );
    }

    return deepMerge(DEFAULT_CONFIG, legacyOverrides, storedConfig);
  }

  // ─── getPublic ───────────────────────────────────────────────────────────────

  /**
   * Config sanitizada para el storefront público.
   * NO expone claves secretas (stripe.secretKey, etc.).
   */
  async getPublic(slug: string): Promise<Record<string, unknown>> {
    const tenant = await this.tenantModel.findOne({ slug }).lean();
    if (!tenant) throw new NotFoundException("Tenant no encontrado");

    const config = await this.getEffective(String(tenant._id));

    // Sanitizar — clonar y borrar campos sensibles
    const safe = JSON.parse(JSON.stringify(config)) as Record<string, unknown>;

    const payments = safe.payments as Record<string, unknown> | undefined;
    const providers = payments?.providers as
      | Record<string, Record<string, unknown>>
      | undefined;
    if (providers) {
      delete providers.stripe?.secretKey;
      delete providers.stripe?.webhookSecret;
      delete providers.mercadopago?.accessToken;
      delete providers.paypal?.clientSecret;
    }

    return safe;
  }

  // ─── update ──────────────────────────────────────────────────────────────────

  /**
   * Aplica un patch parcial al config del tenant.
   * Crea una nueva versión en tenant_configs y actualiza las referencias en Tenant.
   *
   * @param tenantId   ObjectId del tenant
   * @param patch      Patch parcial (deep-mergeado sobre la config efectiva actual)
   * @param changedBy  Email del usuario que hizo el cambio (para auditoría)
   */
  async update(
    tenantId: string,
    patch: Record<string, unknown>,
    changedBy?: string,
  ): Promise<Record<string, unknown>> {
    const ctx = "TenantConfigService.update";

    // ── 1. Cargar tenant ─────────────────────────────────────────────────────
    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant) throw new NotFoundException("Tenant no encontrado");

    // ── 2. Calcular config resultante (merge) ─────────────────────────────────
    const current = await this.getEffective(tenantId);
    const next = deepMerge(current, patch);

    // ── 3. Desactivar TODOS los snapshots activos del tenant ─────────────────
    // updateMany en lugar de updateOne para limpiar cualquier estado sucio
    // (p.ej. múltiples docs con is_active:true por runs previos fallidos).
    // Es FATAL: si falla la deactivación, el índice único {tenant_id, is_active:true}
    // va a hacer fallar el create de todas formas — mejor cortar acá con mensaje claro.
    try {
      await this.tenantConfigModel.updateMany(
        { tenant_id: new Types.ObjectId(tenantId), is_active: true },
        { $set: { is_active: false } },
      );
    } catch (err: unknown) {
      this.logger.logError(err, ctx, {
        step: "deactivate-old-configs",
        tenantId,
      });
      throw new InternalServerErrorException(
        `No se pudo desactivar la config anterior: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── 4. Crear nuevo snapshot ───────────────────────────────────────────────
    const nextVersion = (tenant.config_version ?? 0) + 1;
    const hash = crypto
      .createHash("md5")
      .update(JSON.stringify(next))
      .digest("hex")
      .slice(0, 12);

    // next no debe tener _id (lo filtramos en getEffective), pero por seguridad
    // lo eliminamos aquí también antes del spread.
    const nextSafe = Object.fromEntries(
      Object.entries(next).filter(([k]) => k !== "_id"),
    );

    let newConfig: { _id: Types.ObjectId };
    try {
      // strict: false en el schema permite almacenar los campos libres de next
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      newConfig = await (
        this.tenantConfigModel as unknown as Model<any>
      ).create({
        tenant_id: new Types.ObjectId(tenantId),
        version: nextVersion,
        is_active: true,
        label: null,
        changed_by: changedBy ?? null,
        config_hash: hash,
        // Campos conocidos del schema (legacy compat)
        modules: nextSafe.modules ?? {},
        payment_methods: {},
        checkout_fields: {},
        business_types: tenant.business_types ?? [],
        template_id: tenant.template_id ?? null,
        theme: tenant.theme ?? {},
        // Campos libres de la config (branding, catalog, fulfillment, etc.)
        ...nextSafe,
      });
    } catch (err: unknown) {
      this.logger.logError(err, ctx, {
        step: "create-snapshot",
        tenantId,
        nextVersion,
        activeConfigId: String(tenant.active_config_id),
      });
      throw new InternalServerErrorException(
        `No se pudo crear el snapshot de config (v${nextVersion}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // ── 5. Actualizar referencias en el Tenant ────────────────────────────────
    tenant.active_config_id = newConfig._id as Types.ObjectId;
    tenant.config_version = nextVersion;
    (tenant as unknown as Record<string, unknown>).config_hash = hash;

    // Sincronizar campos legacy del Tenant (fulfillment y modules)
    if (next.fulfillment && typeof next.fulfillment === "object") {
      const rawModes = (next.fulfillment as Record<string, unknown>).modes;
      if (rawModes && typeof rawModes === "object") {
        // Eliminar _id antes de asignar — next.fulfillment.modes puede traer un _id:buffer
        // heredado del stored config (guardado antes de este fix) que Mongoose no puede castear.
        const cleanModes = Object.fromEntries(
          Object.entries(rawModes as Record<string, unknown>).filter(
            ([k]) => k !== "_id",
          ),
        );
        tenant.orderModes = cleanModes as {
          dine_in: boolean;
          takeaway: boolean;
          delivery: boolean;
        };
      }
    }
    if (next.modules) {
      // Eliminar _id del subdocumento antes de asignar — evita conflictos
      // de validación de Mongoose al guardar el Tenant.
      const cleanMods = Object.fromEntries(
        Object.entries(next.modules as Record<string, unknown>).filter(
          ([k]) => k !== "_id",
        ),
      );
      tenant.modules = cleanMods as typeof tenant.modules;
    }
    if (next.booking_settings && typeof next.booking_settings === "object") {
      const cleanSettings = Object.fromEntries(
        Object.entries(next.booking_settings as Record<string, unknown>).filter(
          ([k]) => k !== "_id",
        ),
      );
      (tenant as any).booking_settings = cleanSettings;
    }

    try {
      await tenant.save();
    } catch (err: unknown) {
      this.logger.logError(err, ctx, { step: "save-tenant", tenantId });
      throw new InternalServerErrorException(
        `Config guardada pero el Tenant no se actualizó: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return next;
  }
}
