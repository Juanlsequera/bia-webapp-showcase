import {
  Controller,
  Patch,
  Get,
  Body,
  Param,
  UseGuards,
  Query,
  HttpCode,
  ForbiddenException,
  NotFoundException,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags, ApiBearerAuth } from "@nestjs/swagger";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import type { Response } from "express";

import { OnboardingService } from "../services/onboarding.service";
import { ConfigureTenantDto } from "../dto/configure-tenant.dto";
import { JwtAuthGuard } from "../../auth/guards/jwt.guard";
import { SuperAdminGuard } from "../../auth/guards/superadmin.guard";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthUser } from "@foodorder/types";
import { AppLogger } from "../../logger/logger.service";
import {
  Tenant,
  type TenantDocument,
} from "../../tenant/schemas/tenant.schema";
import { welcomeEmailHtml } from "../email/welcome.template";

/**
 * Endpoints para el flujo de onboarding de tenants.
 * Acceso restringido a superadmin.
 */
@ApiTags("Onboarding")
@Controller("onboarding")
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@ApiBearerAuth("jwt")
export class OnboardingController {
  constructor(
    private readonly onboardingService: OnboardingService,
    private readonly logger: AppLogger,
    @InjectModel(Tenant.name)
    private readonly tenantModel: Model<TenantDocument>,
  ) {}

  /**
   * GET /onboarding/templates
   *
   * Obtener todas las templates disponibles.
   * Soporta filtrar por archetype con ?archetype=food
   */
  @Get("templates")
  @HttpCode(200)
  @ApiOperation({
    summary: "Obtener templates disponibles",
    description:
      "Lista todas las templates que pueden ser usadas para configurar un tenant",
  })
  async getAllTemplates(@Query("archetype") archetype?: string) {
    this.logger.log(
      `[onboarding] GET templates (archetype=${archetype || "all"})`,
    );

    if (archetype) {
      return this.onboardingService.getTemplatesByArchetype(archetype);
    }

    return this.onboardingService.getAllTemplates();
  }

  /**
   * GET /onboarding/templates/:id
   *
   * Obtener detalles de una template específica.
   */
  @Get("templates/:id")
  @HttpCode(200)
  @ApiOperation({
    summary: "Obtener detalles de una template",
  })
  async getTemplateDetails(@Param("id") templateId: string) {
    this.logger.log(`[onboarding] GET templates/${templateId}`);
    return this.onboardingService.getTemplateDetails(templateId);
  }

  /**
   * PATCH /onboarding/tenants/:id/configure
   *
   * Configurar un tenant con una template y módulos específicos.
   * Flujo de 7 pasos:
   * 1. Validar entrada y obtener template
   * 2. Actualizar tenant con plan, business_types, template_id
   * 3. Crear entrada en TenantConfig (versionada)
   * 4. Seedear categorías y productos del template
   * 5. Actualizar módulos del tenant
   * 6. Marcar tenant como onboarded
   * 7. Enviar email de bienvenida
   */
  @Patch("tenants/:id/configure")
  @HttpCode(200)
  @ApiOperation({
    summary: "Configurar tenant con una template",
    description:
      "Inicia el flujo completo de onboarding: copia la template al tenant, seedea productos y categorías, habilita módulos",
  })
  async configureTenant(
    @Param("id") tenantId: string,
    @Body() dto: ConfigureTenantDto,
    @CurrentUser() user: AuthUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader(
      "X-Deprecated",
      "Use PATCH /tenants/:id/configure instead. This alias will be removed in v2.",
    );
    this.logger.log(
      `[onboarding] PATCH tenants/${tenantId}/configure (template=${dto.template_id}, plan=${dto.plan})`,
      "OnboardingController",
    );

    return this.onboardingService.configure(tenantId, dto, user.email);
  }

  /**
   * GET /onboarding/tenants/:id/config-history
   *
   * Obtener historial de configuraciones de un tenant (auditoría).
   */
  @Get("tenants/:id/config-history")
  @HttpCode(200)
  @ApiOperation({
    summary: "Obtener historial de configuraciones",
    description: "Lista todas las versiones de configuración de un tenant",
  })
  async getConfigHistory(@Param("id") tenantId: string) {
    this.logger.log(`[onboarding] GET tenants/${tenantId}/config-history`);
    return this.onboardingService.getConfigHistory(tenantId);
  }

  /**
   * GET /onboarding/tenants/:id/config-active
   *
   * Obtener la configuración activa de un tenant.
   */
  @Get("tenants/:id/config-active")
  @HttpCode(200)
  @ApiOperation({
    summary: "Obtener configuración activa",
    description:
      "Retorna la configuración activa (versión más reciente) de un tenant",
  })
  async getActiveConfig(@Param("id") tenantId: string) {
    this.logger.log(`[onboarding] GET tenants/${tenantId}/config-active`);
    return this.onboardingService.getActiveConfig(tenantId);
  }

  /**
   * GET /onboarding/email/preview?tenantId=xxx
   *
   * Preview del welcome email en el browser. Solo dev (NODE_ENV !== production).
   * Útil para revisar el diseño sin enviar emails reales.
   */
  @Get("email/preview")
  @HttpCode(200)
  @ApiOperation({
    summary: "Preview del welcome email (solo dev)",
    description:
      "Renderiza el HTML del welcome email para un tenant dado. Bloqueado en producción.",
  })
  async previewWelcomeEmail(
    @Query("tenantId") tenantId: string,
    @Res() res: Response,
  ) {
    if (process.env.NODE_ENV === "production") {
      throw new ForbiddenException("Preview deshabilitado en producción");
    }
    const tenant = await this.tenantModel.findById(tenantId).lean();
    if (!tenant) {
      throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
    }
    const archetype: string = (tenant as any).business_types?.[0] ?? "food";
    const archetypeLabels: Record<string, string> = {
      food: "Restaurante / Comida",
      retail: "Tienda / Retail",
      booking: "Citas y Reservas",
      service: "Servicios Técnicos",
    };
    const html = welcomeEmailHtml({
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      adminEmail: "admin@example.com",
      panelUrl: `http://localhost:5173/${tenant.slug}/admin/login`,
      publicUrl: `http://localhost:5173/${tenant.slug}/mesa/1`,
      planLabel: (tenant as any).plan ?? "Pro",
      archetypeLabel: archetypeLabels[archetype] ?? "Restaurante / Comida",
      templateLabel: (tenant as any).template_id ?? null,
      archetype,
    });
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  }
}
