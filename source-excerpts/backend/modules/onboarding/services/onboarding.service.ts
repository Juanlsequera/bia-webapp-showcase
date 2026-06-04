import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { InjectModel, InjectConnection } from "@nestjs/mongoose";
import { Model, Types, Connection, ClientSession } from "mongoose";
import * as crypto from "crypto";

import { ConfigureTenantDto } from "../dto/configure-tenant.dto";
import {
  TenantConfig,
  type TenantConfigDocument,
} from "../../tenant/schemas/tenant-config.schema";
import {
  Tenant,
  type TenantDocument,
} from "../../tenant/schemas/tenant.schema";
import { User, type UserDocument } from "../../auth/schemas/user.schema";
import { MenuService } from "../../menu/menu.service";
import { AppLogger } from "../../logger/logger.service";
import { EmailService } from "../../auth/email.service";

import {
  getTemplateById,
  toTemplateSummary,
  type TemplateDefinition,
} from "../templates/index";
import type { ConfigureTenantResponse, BusinessType } from "@foodorder/types";
import {
  getDefaultModulesForArchetype,
  PLAN_MODULE_MAP,
} from "@foodorder/types";
import { welcomeEmailHtml, welcomeEmailText } from "../email/welcome.template";

@Injectable()
export class OnboardingService {
  // Cacheado del check de transacciones Mongo. Atlas y replica sets soportan;
  // standalone (docker-compose dev/test) no. La detección corre solo la primera vez.
  private transactionSupport: boolean | null = null;

  constructor(
    @InjectModel(TenantConfig.name)
    private tenantConfigModel: Model<TenantConfigDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectConnection() private readonly connection: Connection,
    private readonly menuService: MenuService,
    private readonly logger: AppLogger,
    private readonly emailService: EmailService,
  ) {}

  /**
   * Detecta si el Mongo conectado soporta transacciones (replica set o mongos).
   * Standalone Mongo tira `MongoServerError: Transaction numbers are only allowed...`
   * solo cuando hay una escritura adentro de la transacción — un probe vacío no
   * dispara el error, por eso usamos el comando `hello` que devuelve `setName`
   * solo si el nodo pertenece a un replica set.
   * Cacheamos el resultado para no preguntar en cada request.
   */
  private async supportsTransactions(): Promise<boolean> {
    if (this.transactionSupport !== null) return this.transactionSupport;
    try {
      const db = this.connection.db;
      if (!db) {
        this.transactionSupport = false;
        return false;
      }
      const result = await db.admin().command({ hello: 1 });
      // `setName` aparece solo en replica sets; en mongos hay `msg: 'isdbgrid'`.
      // Standalone no trae ninguna de las dos.
      this.transactionSupport = Boolean(
        result?.setName || result?.msg === "isdbgrid",
      );
    } catch (error) {
      this.logger.warn(
        `[onboarding] hello command falló: ${String(error)} — asumiendo standalone`,
        "OnboardingService",
      );
      this.transactionSupport = false;
    }
    return this.transactionSupport!;
  }

  /**
   * Flujo principal de configuración del tenant en 7 pasos.
   *
   * Paso 1: Obtener tenant y validar estado
   * Paso 2: Actualizar tenant con info básica (plan, business_types, template_id)
   * Paso 3: Crear entrada en TenantConfig
   * Paso 4: Seedear categorías y productos del template
   * Paso 5: Actualizar módulos habilitados
   * Paso 6: Marcar tenant como onboarded
   * Paso 7: Enviar email de bienvenida
   */
  async configure(
    tenantId: string,
    dto: ConfigureTenantDto,
    changedBy?: string,
  ): Promise<ConfigureTenantResponse> {
    const traceId = crypto.randomUUID();
    this.logger.log(
      `[onboarding] Starting configure for tenant ${tenantId} (template=${dto.template_id}, plan=${dto.plan})`,
      "OnboardingService",
      traceId,
    );

    // Paso 1: Obtener tenant y validar estado
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException("Invalid tenantId");
    }
    const tenant = await this.tenantModel.findById(tenantId);
    if (!tenant) {
      this.logger.error(
        `[onboarding] Tenant not found: ${tenantId}`,
        "NotFound",
        "OnboardingService",
        traceId,
      );
      throw new NotFoundException(`Tenant ${tenantId} not found`);
    }
    if (tenant.onboarded) {
      throw new ConflictException(
        `Tenant "${tenant.slug}" ya fue configurado (onboarded=true)`,
      );
    }

    // Validar y obtener template
    let template: TemplateDefinition;
    try {
      template = getTemplateById(dto.template_id);
    } catch (error) {
      this.logger.error(
        `[onboarding] Template not found: ${dto.template_id}`,
        String(error),
        "OnboardingService",
        traceId,
      );
      throw new BadRequestException(
        `Template con id "${dto.template_id}" no existe`,
      );
    }

    // Validar match archetype/business_types
    if (template.archetype !== dto.business_types[0]) {
      throw new BadRequestException(
        `El archetype del template "${template.archetype}" no coincide con business_types[0] "${dto.business_types[0]}"`,
      );
    }

    // Pre-generar _id para romper la dependencia circular
    // (tenant necesita configId, tenantConfig necesita tenantId).
    const configId = new Types.ObjectId();
    const nextVersion = (tenant.config_version || 0) + 1;

    // Calcular módulos y hash fuera de la transacción (solo lectura).
    // Orden de prioridad (menor a mayor):
    //   1. Defaults del arquetipo  → base completa (todos los campos explícitos)
    //   2. defaultModules del template → ajuste fino por caso de uso
    //   3. dto.modules (elecciones del usuario en el wizard) → máxima prioridad
    //   4. Restricciones del plan → siempre ganan (fuerzan false los módulos bloqueados)
    const planMap = PLAN_MODULE_MAP[dto.plan] ?? {};
    const planRestrictions = Object.fromEntries(
      Object.entries(planMap).filter(([, v]) => v === false),
    );
    // Filtrar undefined/null de dto.modules antes del spread.
    // class-transformer con enableImplicitConversion:true inicializa TODOS los campos
    // del DTO con `undefined` aunque el payload sea `{}`. Al hacer spread, esos
    // `undefined` SOBREESCRIBEN los valores `true` del arquetipo (booking, staff_management…).
    // Solo las elecciones explícitas del usuario (true/false reales) deben tener efecto.
    const explicitModules = dto.modules
      ? (Object.fromEntries(
          Object.entries(dto.modules as Record<string, unknown>).filter(
            ([, v]) => v !== undefined && v !== null,
          ),
        ) as Record<string, boolean>)
      : ({} as Record<string, boolean>);
    const modules = {
      ...getDefaultModulesForArchetype(template.archetype as BusinessType),
      ...template.defaultModules,
      ...explicitModules,
      ...planRestrictions, // override final: el plan manda sobre cualquier elección
    };
    const configHash = this.computeConfigHash({
      plan: dto.plan,
      business_types: dto.business_types,
      template_id: dto.template_id,
      modules,
    });

    // Pasos 2+3+5+6: escrituras atómicas vía transacción cuando Mongo lo soporte
    // (Atlas/replica set en prod). En standalone (dev/test con docker-compose),
    // ejecuta las mismas escrituras sin session — best-effort, log warning.
    const writeOps = async (session?: ClientSession): Promise<void> => {
      // Paso 2: actualizar campos del tenant
      tenant.plan = dto.plan;
      tenant.business_types = dto.business_types;
      tenant.template_id = dto.template_id;
      tenant.modules = modules;
      tenant.config_hash = configHash;

      // Paso 3: crear TenantConfig con el _id pre-generado
      const tenantConfigDoc = {
        _id: configId,
        tenant_id: new Types.ObjectId(tenantId),
        version: nextVersion,
        is_active: true,
        label: `Configuración v${nextVersion} - ${template.label}`,
        changed_by: changedBy || "system",
        theme: tenant.theme,
        modules,
        payment_methods: {},
        checkout_fields: {},
        business_types: dto.business_types,
        template_id: dto.template_id,
        config_hash: configHash,
      };
      await this.tenantConfigModel.create(
        [tenantConfigDoc],
        session ? { session } : {},
      );

      // Pasos 5+6: referencias al config + marcar onboarded en un único save
      tenant.config_version = nextVersion;
      tenant.active_config_id = configId;
      tenant.onboarded = true;
      await tenant.save(session ? { session } : undefined);
    };

    if (await this.supportsTransactions()) {
      const session = await this.connection.startSession();
      try {
        await session.withTransaction(() => writeOps(session));
      } finally {
        await session.endSession();
      }
    } else {
      // Mongo standalone (dev/test): sin atomicidad. Si una falla a mitad podría
      // dejar inconsistencia entre Tenant.active_config_id y la doc real en
      // tenant_configs. Aceptable para dev; en prod usar replica set.
      this.logger.warn(
        "[onboarding] Mongo sin soporte de transacciones — escribiendo sin atomicidad",
        "OnboardingService",
        traceId,
      );
      await writeOps();
    }

    this.logger.log(
      `[onboarding] Tenant + TenantConfig committed atomically (id=${tenantId}, configId=${configId}, version=${nextVersion})`,
      "OnboardingService",
      traceId,
    );

    // Paso 4: Seedear productos (best-effort, fuera de la transacción)
    let seededCategories = new Set<string>();
    let seededProducts = 0;

    for (const product of template.products) {
      try {
        await this.menuService.create(tenantId, {
          name: product.name,
          description: product.description || "",
          price: product.price,
          category: product.category,
          image_url: product.imageUrl || null,
          duration_minutes: product.durationMin ?? null,
          // Booking / service archetypes default to type='service'; others to 'prepared'
          type:
            product.type ??
            (template.archetype === "booking" ||
            template.archetype === "service"
              ? "service"
              : "prepared"),
        });
        seededProducts++;
        seededCategories.add(product.category);
      } catch (error) {
        this.logger.warn(
          `[onboarding] Failed to create product ${product.name}: ${String(error)}`,
          "OnboardingService",
          traceId,
        );
      }
    }

    this.logger.log(
      `[onboarding] Template seeded (categories=${seededCategories.size}, products=${seededProducts})`,
      "OnboardingService",
      traceId,
    );

    // Paso 7: Enviar email de bienvenida (best-effort, no fallar si hay error)
    try {
      await this.sendWelcomeEmail(tenant, dto, traceId);
    } catch (error) {
      this.logger.warn(
        `[onboarding] sendWelcomeEmail failed: ${String(error)}`,
        "OnboardingService",
        traceId,
      );
    }

    this.logger.log(
      `[onboarding] Configure completed successfully (id=${tenantId})`,
      "OnboardingService",
      traceId,
    );

    const tenantObj = tenant.toObject() as any;
    return {
      tenant: {
        ...tenantObj,
        createdAt: tenantObj.createdAt || new Date(),
        updatedAt: tenantObj.updatedAt || new Date(),
      } as any,
      config_id: configId.toString(),
      seeded_categories: seededCategories.size,
      seeded_products: seededProducts,
    };
  }

  /**
   * Obtener todas las templates disponibles (para selección en UI).
   */
  async getAllTemplates() {
    const { getAllTemplatesSummary } = await import("../templates/index");
    return getAllTemplatesSummary();
  }

  /**
   * Obtener templates por archetype.
   */
  async getTemplatesByArchetype(archetype: string) {
    const { getTemplatesByArchetype, toTemplateSummary } =
      await import("../templates/index");
    const templates = getTemplatesByArchetype(archetype);
    return templates.map(toTemplateSummary);
  }

  /**
   * Obtener detalles de un template específico.
   */
  async getTemplateDetails(templateId: string) {
    const template = getTemplateById(templateId);
    return {
      ...template,
      summary: toTemplateSummary(template),
    };
  }

  /**
   * Obtener historial de configuraciones de un tenant.
   */
  async getConfigHistory(tenantId: string) {
    const configs = await this.tenantConfigModel
      .find({ tenant_id: new Types.ObjectId(tenantId) })
      .sort({ version: -1 })
      .lean();

    return configs;
  }

  /**
   * Obtener la configuración activa de un tenant.
   */
  async getActiveConfig(tenantId: string) {
    const config = await this.tenantConfigModel
      .findOne({
        tenant_id: new Types.ObjectId(tenantId),
        is_active: true,
      })
      .lean();

    return config;
  }

  private computeConfigHash(data: Record<string, unknown>): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(data))
      .digest("hex")
      .slice(0, 16);
  }

  /**
   * Envía el welcome email al admin del tenant.
   * Best-effort: si falla, el caller loguea y continúa.
   */
  private async sendWelcomeEmail(
    tenant: TenantDocument,
    dto: ConfigureTenantDto,
    traceId?: string,
  ): Promise<void> {
    const admin = await this.userModel.findOne({
      tenantId: tenant._id,
      role: "admin",
    });
    if (!admin) {
      this.logger.warn(
        `[onboarding] No admin found for tenant ${tenant.slug} — skip welcome email`,
        "OnboardingService",
        traceId,
      );
      return;
    }

    const archetypeLabel: Record<string, string> = {
      food: "Restaurante / Comida",
      retail: "Tienda / Retail",
      booking: "Citas y Reservas",
      service: "Servicios Técnicos",
    };
    const planLabel: Record<string, string> = {
      starter: "Starter",
      pro: "Pro",
      enterprise: "Enterprise",
    };

    // getTemplateById tira Error si no existe — protegerse aunque acá no debería pasar
    let templateLabel: string | null = null;
    if (!dto.template_id.endsWith("-en-blanco")) {
      try {
        templateLabel = getTemplateById(dto.template_id).label;
      } catch {
        templateLabel = null;
      }
    }

    const baseUrl = process.env.WEB_URL ?? "https://bia.app";

    const archetypeEntryPath: Record<string, string> = {
      food: `/${tenant.slug}/mesa/1`,
      retail: `/${tenant.slug}`,
      booking: `/${tenant.slug}/reservar`,
      service: `/${tenant.slug}`,
    };
    const publicPath =
      archetypeEntryPath[dto.business_types[0]] ?? `/${tenant.slug}`;

    const params = {
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      adminEmail: admin.email,
      panelUrl: `${baseUrl}/${tenant.slug}/admin/login`,
      publicUrl: `${baseUrl}${publicPath}`,
      planLabel: planLabel[dto.plan] ?? dto.plan,
      archetypeLabel:
        archetypeLabel[dto.business_types[0]] ?? dto.business_types[0],
      templateLabel,
      archetype: dto.business_types[0],
    };

    await this.emailService.send({
      to: admin.email,
      subject: `Tu negocio "${tenant.name}" ya está activo en BIA 🚀`,
      html: welcomeEmailHtml(params),
      text: welcomeEmailText(params),
    });
  }
}
