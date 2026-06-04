import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody,
} from "@nestjs/swagger";
import { QrPageService } from "./qr-page.service";
import {
  CreateQrPageDto,
  UpdateQrPageDto,
  CreatePaymentFromQrDto,
} from "./dto/qr-page.dto";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { ParseSlugPipe } from "../../common/pipes/parse-slug.pipe";
import {
  ApiAuthErrors,
  ApiValidationError,
  ApiNotFound,
} from "../../common/decorators/api-errors.decorator";
import type { AuthUser } from "@bia/types";

// ── Admin controller ──────────────────────────────────────────────────────────
//
// QR Pages es una feature ESTÁNDAR — sin @RequireModule.
// El guard de módulo no aplica aquí.

@ApiTags("QR Pages")
@ApiBearerAuth("jwt")
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles("admin")
@Controller("admin/qr-pages")
export class QrPageAdminController {
  constructor(private readonly svc: QrPageService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Crear página QR",
    description:
      "Admin. Crea una página de cobro con URL permanente. " +
      "El shortCode forma parte del QR impreso y no puede cambiarse después. " +
      "Feature estándar — disponible para todos los planes.",
  })
  @ApiResponse({
    status: 201,
    description: "Página QR creada.",
    schema: {
      example: {
        _id: "6620f14c1a9e3a2b4c8d9999",
        shortCode: "mostrador",
        title: "Pago en mostrador",
        type: "fixed_amount",
        amount: 15,
        isActive: true,
      },
    },
  })
  @ApiResponse({
    status: 409,
    description: "El shortCode ya existe para este tenant.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateQrPageDto) {
    return this.svc.create(user.tenantId!, user, dto);
  }

  @Get()
  @ApiOperation({ summary: "Listar páginas QR del tenant" })
  @ApiResponse({ status: 200, description: "Array de páginas QR." })
  @ApiAuthErrors()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user.tenantId!);
  }

  @Get(":id")
  @ApiOperation({ summary: "Obtener una página QR por ID" })
  @ApiParam({ name: "id", description: "ObjectId de la página QR" })
  @ApiResponse({ status: 200, description: "Datos de la página QR." })
  @ApiAuthErrors()
  @ApiNotFound("La página QR")
  findOne(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    return this.svc.findOne(user.tenantId!, id);
  }

  @Patch(":id")
  @ApiOperation({
    summary: "Editar página QR",
    description:
      "Admin. Edita cualquier campo EXCEPTO shortCode. " +
      "El QR impreso sigue funcionando con los nuevos datos.",
  })
  @ApiParam({ name: "id", description: "ObjectId de la página QR" })
  @ApiResponse({ status: 200, description: "Página QR actualizada." })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFound("La página QR")
  update(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateQrPageDto,
  ) {
    return this.svc.update(user.tenantId!, id, dto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Eliminar página QR" })
  @ApiParam({ name: "id", description: "ObjectId de la página QR" })
  @ApiResponse({ status: 204, description: "Página QR eliminada." })
  @ApiAuthErrors()
  @ApiNotFound("La página QR")
  async remove(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
  ): Promise<void> {
    await this.svc.remove(user.tenantId!, id);
  }
}

// ── Controlador público ───────────────────────────────────────────────────────

@ApiTags("QR Pages")
@Controller(":tenantSlug/qr")
export class QrPagePublicController {
  constructor(private readonly svc: QrPageService) {}

  @Get(":shortCode")
  @ApiOperation({
    summary: "Configuración pública de la página QR",
    description:
      "Sin auth. El cliente escanea el QR y obtiene la configuración actual. " +
      "Si isActive=false devuelve { isActive: false } con HTTP 200 " +
      '(el frontend muestra "no disponible" en lugar de un error genérico).',
  })
  @ApiParam({ name: "tenantSlug", example: "mi-peluqueria" })
  @ApiParam({ name: "shortCode", example: "mostrador" })
  @ApiResponse({
    status: 200,
    description: "Configuración de la página QR.",
    schema: {
      example: {
        isActive: true,
        qrPage: {
          _id: "6620f14c",
          title: "Pago en mostrador",
          type: "fixed_amount",
          amount: 15,
          paymentMethods: ["pagomovil"],
          defaultPaymentMethod: "pagomovil",
        },
        bankAccountSnapshot: { bank: "Banesco", phone: "04141234567" },
      },
    },
  })
  @ApiNotFound("La página QR")
  getPublicConfig(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("shortCode") shortCode: string,
  ) {
    return this.svc.getPublicConfig(tenantSlug, shortCode);
  }

  @Post(":shortCode/pay")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Iniciar pago desde la página QR",
    description:
      "Sin auth. El cliente confirma el pago: se crea un PaymentLink con el " +
      "monto calculado server-side y se devuelve su _id. " +
      "El frontend redirige a /:tenantSlug/pago/:linkId para completar el cobro.",
  })
  @ApiParam({ name: "tenantSlug", example: "mi-peluqueria" })
  @ApiParam({ name: "shortCode", example: "mostrador" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        paymentMethod: { type: "string", example: "pagomovil" },
        items: {
          type: "array",
          description: "Para product_selection",
          items: {
            type: "object",
            properties: {
              productId: { type: "string" },
              quantity: { type: "number" },
            },
          },
        },
        amount: { type: "number", description: "Para open_amount" },
        customerName: {
          type: "string",
          description: "Nombre del cliente (opcional)",
        },
      },
      required: ["paymentMethod"],
    },
  })
  @ApiResponse({
    status: 201,
    description: "PaymentLink creado. Redirigir a /:tenantSlug/pago/:linkId.",
    schema: {
      example: {
        _id: "6620f14c1a9e3a2b4c8d9999",
        amount: 15,
        status: "active",
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Página inactiva o datos inválidos.",
  })
  @ApiValidationError()
  @ApiNotFound("La página QR")
  createPaymentFromQr(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("shortCode") shortCode: string,
    @Body() dto: CreatePaymentFromQrDto,
  ) {
    return this.svc.createPaymentFromQr(tenantSlug, shortCode, dto);
  }
}
