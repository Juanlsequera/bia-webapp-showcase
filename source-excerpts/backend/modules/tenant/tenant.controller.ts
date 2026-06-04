import {
  Controller,
  Get,
  Patch,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
  ApiConsumes,
} from "@nestjs/swagger";
import { TenantService } from "./tenant.service";
import { TenantConfigService } from "./tenant-config.service";
import { MediaService } from "../media/media.service";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { UpdateTenantDto } from "./dto/update-tenant.dto";
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from "./dto/bank-account.dto";
import {
  CreateTransferAccountDto,
  UpdateTransferAccountDto,
} from "./dto/transfer-account.dto";
import {
  CreateZelleAccountDto,
  UpdateZelleAccountDto,
} from "./dto/zelle-account.dto";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthUser, TenantPublic, CreateTenantResponse } from "@bia/types";
import { TenantDocument } from "./schemas/tenant.schema";
import {
  ApiAuthErrors,
  ApiValidationError,
  ApiNotFound,
  ApiConflict,
} from "../../common/decorators/api-errors.decorator";
import { ParseSlugPipe } from "../../common/pipes/parse-slug.pipe";
import { assertValidImageFile } from "../../common/utils/validate-image";

@ApiTags("Tenants")
@Controller("tenants")
export class TenantController {
  constructor(
    private readonly tenantService: TenantService,
    private readonly tenantConfigService: TenantConfigService,
    private readonly mediaService: MediaService,
  ) {}

  // ── Público: config del tenant para el cliente final ──────────────
  @Get(":slug/public")
  @Throttle({ relaxed: { ttl: 60_000, limit: 600 } }) // Datos públicos estáticos — BCV cacheado en Redis, no hay razón para limitarlo fuerte
  @ApiOperation({
    summary: "Config pública del tenant (cliente final)",
    description:
      "Sin auth. Devuelve nombre, logo, tema y datos de PagoMóvil. " +
      "La app lo llama al cargar `/:slug/mesa/:n` para aplicar el branding.",
  })
  @ApiParam({ name: "slug", example: "la-hamburgueseria" })
  @ApiResponse({ status: 200, description: "Datos públicos del tenant." })
  @ApiNotFound("El tenant")
  getPublic(@Param("slug", ParseSlugPipe) slug: string): Promise<TenantPublic> {
    return this.tenantService.getPublicBySlug(slug);
  }

  // ── Admin: su propia config completa ──────────────────────────────
  @Get("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Config completa del tenant actual",
    description:
      "Admin-only. Devuelve toda la info del tenant asociado al JWT (incluye campos privados).",
  })
  @ApiResponse({ status: 200, description: "Datos completos del tenant." })
  @ApiAuthErrors()
  getMe(@CurrentUser() user: AuthUser): Promise<TenantDocument> {
    if (!user.tenantId) {
      throw new ForbiddenException("Usuario admin sin tenant asociado");
    }
    return this.tenantService.getMe(user.tenantId);
  }

  // ── Admin: actualiza nombre, logo, tema, pagomovil ────────────────
  @Patch("me")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Actualizar nombre, logo, tema, PagoMóvil",
    description:
      "Admin-only. Sólo actualiza los campos enviados (partial update). " +
      "El slug NO se cambia desde acá.",
  })
  @ApiResponse({ status: 200, description: "Tenant actualizado." })
  @ApiValidationError()
  @ApiAuthErrors()
  updateMe(
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateTenantDto,
  ): Promise<TenantDocument> {
    if (!user.tenantId) {
      throw new ForbiddenException("Usuario admin sin tenant asociado");
    }
    return this.tenantService.updateMe(user.tenantId, dto);
  }

  // ── Superadmin: listar todos los tenants ──────────────────────────
  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("superadmin")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Listar todos los tenants (superadmin)",
    description: "Superadmin-only. Devuelve todos los negocios dados de alta.",
  })
  @ApiResponse({ status: 200, description: "Array de tenants." })
  @ApiAuthErrors()
  findAll(): Promise<TenantDocument[]> {
    return this.tenantService.findAll();
  }

  // ── Superadmin: dar de alta empresa + admin inicial ───────────────
  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("superadmin")
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Alta de tenant + primer admin",
    description:
      "Superadmin-only. Transacción: crea el tenant y su primer usuario admin en un solo paso. " +
      "Si algo falla, hace rollback.",
  })
  @ApiResponse({ status: 201, description: "Tenant creado." })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiConflict("El slug o el email ya están tomados.")
  create(@Body() dto: CreateTenantDto): Promise<CreateTenantResponse> {
    return this.tenantService.createWithAdmin(dto);
  }

  // ── Superadmin: activar / suspender un tenant ─────────────────────
  @Patch(":tenantId/active")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("superadmin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Activar o suspender un tenant",
    description:
      "Superadmin-only. Suspender bloquea el acceso del admin y oculta el menú público " +
      "(sin borrar datos históricos).",
  })
  @ApiParam({ name: "tenantId", description: "ObjectId del tenant" })
  @ApiBody({
    schema: {
      type: "object",
      properties: { active: { type: "boolean", example: true } },
      required: ["active"],
    },
  })
  @ApiResponse({ status: 200, description: "Tenant actualizado." })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFound("El tenant")
  setActive(
    @Param("tenantId") tenantId: string,
    @Body("active") active: boolean,
  ): Promise<TenantDocument> {
    if (typeof active !== "boolean") {
      throw new BadRequestException('El campo "active" es requerido (boolean)');
    }
    return this.tenantService.setActive(tenantId, active);
  }

  // ── Superadmin: cambiar plan de un tenant ────────────────────────
  @Patch(":tenantId/plan")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("superadmin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Cambiar plan de un tenant (superadmin)" })
  @ApiParam({ name: "tenantId", description: "ObjectId del tenant" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        plan: { type: "string", enum: ["starter", "pro", "enterprise"] },
      },
      required: ["plan"],
    },
  })
  @ApiResponse({ status: 200, description: "{ ok: true }" })
  @ApiAuthErrors()
  @ApiNotFound("El tenant")
  async changePlan(
    @Param("tenantId") tenantId: string,
    @Body("plan") plan: "starter" | "pro" | "enterprise",
  ): Promise<{ ok: boolean }> {
    if (!["starter", "pro", "enterprise"].includes(plan)) {
      throw new BadRequestException(
        "Plan inválido. Valores válidos: starter, pro, enterprise",
      );
    }
    await this.tenantService.changePlan(tenantId, plan);
    return { ok: true };
  }

  // ── Superadmin: actualizar módulos de un tenant ───────────────────
  @Patch(":tenantId/modules")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("superadmin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Actualizar módulos habilitados de un tenant (superadmin)",
    description:
      "Superadmin-only. Reemplaza el mapa de módulos del tenant y crea una nueva " +
      "versión de TenantConfig. Los módulos no incluidos en el body se mantienen " +
      "con su valor actual (deep-merge).",
  })
  @ApiParam({ name: "tenantId", description: "ObjectId del tenant" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        modules: {
          type: "object",
          example: {
            kitchen_kds: true,
            booking: false,
            inventory_tracking: false,
          },
        },
      },
      required: ["modules"],
    },
  })
  @ApiResponse({
    status: 200,
    description: "Config efectiva con módulos actualizados.",
  })
  @ApiAuthErrors()
  @ApiNotFound("El tenant")
  patchModules(
    @Param("tenantId") tenantId: string,
    @Body("modules") modules: Record<string, boolean>,
    @CurrentUser() user: AuthUser,
  ): Promise<Record<string, unknown>> {
    if (!modules || typeof modules !== "object") {
      throw new BadRequestException('El campo "modules" es requerido (object)');
    }
    // Eliminar _id que Mongoose agrega a subdocumentos del Tenant
    // (el frontend lo reenvía tal cual y causaría conflictos al guardar).
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { _id: _ignored, ...cleanModules } = modules as Record<
      string,
      unknown
    >;
    return this.tenantConfigService.update(
      tenantId,
      { modules: cleanModules },
      user.email,
    );
  }

  // ── Upload logo del tenant ────────────────────────────────────────
  @Post("me/upload-logo")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth("jwt")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 3 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary: "Subir logo del negocio a Cloudinary",
    description:
      "Admin-only. PNG/JPG/WebP, máx 3MB. Devuelve la URL para usar en logo_url.",
  })
  @ApiResponse({ status: 201, description: "{ url: string }" })
  @ApiAuthErrors()
  async uploadLogo(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!user.tenantId) throw new ForbiddenException("Sin tenantId en JWT");
    assertValidImageFile(file);
    const result = await this.mediaService.uploadImage(file.buffer, {
      folder: `bia/${user.tenantId}/logos`,
      filename: `logo-${Date.now()}`,
    });
    // Persistir automáticamente en el tenant
    await this.tenantService.updateMe(user.tenantId, { logo_url: result.url });
    return { url: result.url };
  }

  // ── Upload portada del tenant ─────────────────────────────────────
  @Post("me/upload-cover")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth("jwt")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary: "Subir imagen de portada (banner) del negocio a Cloudinary",
    description:
      "Admin-only. PNG/JPG/WebP, máx 5MB. Se guarda en cover_url del tenant.",
  })
  @ApiResponse({ status: 201, description: "{ url: string }" })
  @ApiAuthErrors()
  async uploadCover(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<{ url: string }> {
    if (!user.tenantId) throw new ForbiddenException("Sin tenantId en JWT");
    assertValidImageFile(file);
    const result = await this.mediaService.uploadImage(file.buffer, {
      folder: `bia/${user.tenantId}/covers`,
      filename: `cover-${Date.now()}`,
    });
    await this.tenantService.updateMe(user.tenantId, { cover_url: result.url });
    return { url: result.url };
  }

  // ── Cuentas bancarias (P1.16) ─────────────────────────────────────

  @Get("me/bank-accounts")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Listar cuentas bancarias del tenant" })
  @ApiResponse({ status: 200, description: "Array de BankAccount." })
  @ApiAuthErrors()
  getBankAccounts(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.getBankAccounts(user.tenantId);
  }

  @Post("me/bank-accounts")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Agregar cuenta bancaria" })
  @ApiResponse({
    status: 201,
    description: "Cuenta creada. Devuelve el array completo actualizado.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  addBankAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateBankAccountDto,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.addBankAccount(user.tenantId, dto);
  }

  @Patch("me/bank-accounts/:accountId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Editar datos de una cuenta bancaria" })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiResponse({ status: 200, description: "Array actualizado." })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFound("La cuenta bancaria")
  updateBankAccount(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
    @Body() dto: UpdateBankAccountDto,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.updateBankAccount(user.tenantId, accountId, dto);
  }

  @Patch("me/bank-accounts/:accountId/default")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Establecer cuenta predeterminada" })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiResponse({
    status: 200,
    description: "Array actualizado con nuevo default.",
  })
  @ApiAuthErrors()
  @ApiNotFound("La cuenta bancaria")
  setDefaultBankAccount(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.setDefaultBankAccount(user.tenantId, accountId);
  }

  @Delete("me/bank-accounts/:accountId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Eliminar una cuenta bancaria" })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiResponse({
    status: 200,
    description: "Array actualizado sin la cuenta eliminada.",
  })
  @ApiAuthErrors()
  @ApiNotFound("La cuenta bancaria")
  deleteBankAccount(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.deleteBankAccount(user.tenantId, accountId);
  }

  // ── PMV.3 — Upload / borrado del QR S7B por cuenta bancaria ───────

  @Post("me/bank-accounts/:accountId/qr")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth("jwt")
  @ApiConsumes("multipart/form-data")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 2 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary: "Subir QR S7B de la cuenta bancaria",
    description:
      'PNG/JPG/WebP, máx 2MB. El campo opcional "qrRawPayload" (form-data) guarda el texto decodificado del QR.',
  })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiResponse({
    status: 201,
    description: "Cuenta actualizada con qrImageUrl.",
  })
  @ApiAuthErrors()
  @ApiNotFound("La cuenta bancaria")
  async uploadBankAccountQr(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body("qrRawPayload") qrRawPayload?: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    assertValidImageFile(file);
    const result = await this.mediaService.uploadImage(file.buffer, {
      folder: `bia/${user.tenantId}/bank-qrs`,
      filename: `${accountId}-${Date.now()}`,
    });
    const { accounts, previousPublicId } =
      await this.tenantService.setBankAccountQr(user.tenantId, accountId, {
        qrImageUrl: result.url,
        qrPublicId: result.publicId,
        qrRawPayload: qrRawPayload?.trim() ? qrRawPayload.trim() : null,
      });
    // Best-effort cleanup del QR anterior — no bloquea ni propaga errores
    if (previousPublicId && previousPublicId !== result.publicId) {
      this.mediaService.deleteImage(previousPublicId).catch(() => undefined);
    }
    return accounts;
  }

  @Delete("me/bank-accounts/:accountId/qr")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Quitar el QR S7B de una cuenta bancaria" })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiResponse({
    status: 200,
    description: "Array actualizado sin QR en esa cuenta.",
  })
  @ApiAuthErrors()
  @ApiNotFound("La cuenta bancaria")
  async deleteBankAccountQr(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    const { accounts, previousPublicId } =
      await this.tenantService.clearBankAccountQr(user.tenantId, accountId);
    if (previousPublicId) {
      this.mediaService.deleteImage(previousPublicId).catch(() => undefined);
    }
    return accounts;
  }

  // ── Cuentas de transferencia bancaria ────────────────────────────────

  @Get("me/transfer-accounts")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Listar cuentas de transferencia del tenant" })
  @ApiAuthErrors()
  getTransferAccounts(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.getTransferAccounts(user.tenantId);
  }

  @Post("me/transfer-accounts")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Agregar cuenta de transferencia (nacional o internacional)",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  addTransferAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateTransferAccountDto,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.addTransferAccount(user.tenantId, dto);
  }

  @Patch("me/transfer-accounts/:accountId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Editar cuenta de transferencia" })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFound("La cuenta de transferencia")
  updateTransferAccount(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
    @Body() dto: UpdateTransferAccountDto,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.updateTransferAccount(
      user.tenantId,
      accountId,
      dto,
    );
  }

  @Patch("me/transfer-accounts/:accountId/default")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Establecer cuenta de transferencia predeterminada",
  })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiAuthErrors()
  @ApiNotFound("La cuenta de transferencia")
  setDefaultTransferAccount(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.setDefaultTransferAccount(
      user.tenantId,
      accountId,
    );
  }

  @Delete("me/transfer-accounts/:accountId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Eliminar cuenta de transferencia" })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiAuthErrors()
  @ApiNotFound("La cuenta de transferencia")
  deleteTransferAccount(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.deleteTransferAccount(user.tenantId, accountId);
  }

  // ── Cuentas Zelle ─────────────────────────────────────────────────────

  @Get("me/zelle-accounts")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Listar cuentas Zelle del tenant" })
  @ApiAuthErrors()
  getZelleAccounts(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.getZelleAccounts(user.tenantId);
  }

  @Post("me/zelle-accounts")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Agregar cuenta Zelle" })
  @ApiValidationError()
  @ApiAuthErrors()
  addZelleAccount(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateZelleAccountDto,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.addZelleAccount(user.tenantId, dto);
  }

  @Patch("me/zelle-accounts/:accountId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Editar cuenta Zelle" })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFound("La cuenta Zelle")
  updateZelleAccount(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
    @Body() dto: UpdateZelleAccountDto,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.updateZelleAccount(user.tenantId, accountId, dto);
  }

  @Patch("me/zelle-accounts/:accountId/default")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Establecer cuenta Zelle predeterminada" })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiAuthErrors()
  @ApiNotFound("La cuenta Zelle")
  setDefaultZelleAccount(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.setDefaultZelleAccount(user.tenantId, accountId);
  }

  @Delete("me/zelle-accounts/:accountId")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Eliminar cuenta Zelle" })
  @ApiParam({ name: "accountId", description: "ObjectId de la cuenta" })
  @ApiAuthErrors()
  @ApiNotFound("La cuenta Zelle")
  deleteZelleAccount(
    @CurrentUser() user: AuthUser,
    @Param("accountId") accountId: string,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Sin tenant asociado");
    return this.tenantService.deleteZelleAccount(user.tenantId, accountId);
  }

  // ── M2: Config dinámica del tenant (admin) ────────────────────────

  @Get("me/config")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Obtener config efectiva del tenant (admin)",
    description:
      "Devuelve la config activa mergeada con los defaults. Incluye módulos, pagos, campos cliente, etc.",
  })
  @ApiResponse({ status: 200, description: "Config efectiva del tenant." })
  @ApiAuthErrors()
  getMyConfig(@CurrentUser() user: AuthUser) {
    if (!user.tenantId) throw new ForbiddenException("Admin sin tenant");
    return this.tenantConfigService.getEffective(user.tenantId);
  }

  @Patch("me/config")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Patch parcial al config del tenant (admin)",
    description:
      "Aplica un deep merge del patch sobre la config activa y crea una nueva versión." +
      " El admin envía solo los campos que cambiaron. Backward-compat: también actualiza " +
      "tenant.orderModes y tenant.modules para que el flujo actual siga funcionando.",
  })
  @ApiResponse({ status: 200, description: "Config resultante tras el merge." })
  @ApiAuthErrors()
  patchMyConfig(
    @CurrentUser() user: AuthUser,
    @Body() patch: Record<string, unknown>,
  ) {
    if (!user.tenantId) throw new ForbiddenException("Admin sin tenant");
    return this.tenantConfigService.update(user.tenantId, patch, user.email);
  }

  // ── Upsell "¿Lo hacés combo?" ─────────────────────────────────────

  @Patch("me/upsell")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Actualizar configuración de upsell del tenant (admin)",
    description:
      'Activa/desactiva el upsell "¿Lo hacés combo?". ' +
      "addOnProductIds: IDs de los productos add-on. bundleExtraPrice: precio extra en USD.",
  })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        enabled: { type: "boolean" },
        addOnProductIds: { type: "array", items: { type: "string" } },
        bundleExtraPrice: { type: "number" },
      },
    },
  })
  @ApiResponse({ status: 200, description: "Upsell actualizado." })
  @ApiAuthErrors()
  updateUpsell(
    @CurrentUser() user: AuthUser,
    @Body()
    body: {
      enabled?: boolean;
      addOnProductIds?: string[];
      bundleExtraPrice?: number;
    },
  ) {
    if (!user.tenantId) throw new ForbiddenException("Admin sin tenant");
    return this.tenantService.updateUpsell(user.tenantId, body);
  }

  // ── M2: Config pública para el storefront (sin auth) ─────────────

  @Get(":slug/public-config")
  @ApiOperation({
    summary: "Config sanitizada para el storefront público (sin auth)",
    description:
      "Sin auth. Devuelve la config del tenant sin secretos (claves de pago, etc.).",
  })
  @ApiParam({ name: "slug", example: "la-hamburgueseria" })
  @ApiResponse({ status: 200, description: "Config pública del tenant." })
  @ApiNotFound("El tenant")
  getPublicConfig(@Param("slug", ParseSlugPipe) slug: string) {
    return this.tenantConfigService.getPublic(slug);
  }
}
