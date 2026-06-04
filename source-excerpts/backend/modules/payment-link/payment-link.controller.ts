import {
  Controller,
  Post,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { PaymentLinkService } from "./payment-link.service";
import {
  CreatePaymentLinkDto,
  MarkPaidDto,
  SubmitPaymentLinkPagomovilDto,
  SubmitTransferDto,
  SubmitZelleDto,
} from "./dto/payment-link.dto";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { TraceId } from "../../common/decorators/trace-id.decorator";
import { AuthUser } from "@foodorder/types";
import {
  ApiAuthErrors,
  ApiValidationError,
  ApiNotFound,
} from "../../common/decorators/api-errors.decorator";
import { ModuleEnabledGuard } from "../tenant/guards/module-enabled.guard";
import { RequireModule } from "../tenant/decorators/require-module.decorator";
import { ParseSlugPipe } from "../../common/pipes/parse-slug.pipe";
import { assertValidImageFile } from "../../common/utils/validate-image";

/**
 * Rutas admin de Payment Links.
 *
 * Prefix `admin/payment-links` (sin `:tenantSlug`) — el tenant viene del JWT,
 * igual que el resto de controllers admin del repo. Que el slug del URL fuera
 * la fuente de verdad rompía consistencia con el frontend (que llamaba a
 * `/admin/payment-links` y recibía 404) y abría un cross-tenant injection:
 * un admin del tenant A podía postear a `/tenant-b/admin/payment-links` y
 * crear links en B porque el service usaba el slug del URL, no el JWT.
 */
@ApiTags("Payment Links")
@ApiBearerAuth("jwt")
@Controller("admin/payment-links")
@UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
@Roles("admin", "kitchen", "superadmin")
@RequireModule("payment_links")
export class PaymentLinkAdminController {
  constructor(private svc: PaymentLinkService) {}

  @Post()
  @ApiOperation({
    summary: "Crear link de pago",
    description:
      "Admin/kitchen. Genera un link compartible para cobrar un monto específico. " +
      "Útil para cobros puntuales sin crear una comanda completa.",
  })
  @ApiResponse({
    status: 201,
    description: "Link de pago creado.",
    schema: {
      example: {
        _id: "6620f14c1a9e3a2b4c8d9999",
        linkId: "pago-abc123",
        description: "Seña reserva mesa 10 pax",
        amount: 25,
        status: "pending",
        url: "http://localhost:5173/la-hamburgueseria/pago/pago-abc123",
        expiresAt: null,
      },
    },
  })
  @ApiValidationError()
  @ApiAuthErrors()
  create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreatePaymentLinkDto,
    @TraceId() traceId: string,
  ) {
    return this.svc.create(user.tenantId!, user, dto, traceId);
  }

  @Get()
  @ApiOperation({
    summary: "Listar links de pago del tenant",
    description:
      "Admin/kitchen. Devuelve todos los links de pago ordenados por fecha de creación DESC.",
  })
  @ApiResponse({ status: 200, description: "Array de links de pago." })
  @ApiAuthErrors()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.listByTenant(user.tenantId!);
  }

  @Patch(":linkId/cancel")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Cancelar un link de pago",
    description:
      "Admin/kitchen. Invalida el link — el cliente ya no puede usarlo.",
  })
  @ApiParam({ name: "linkId", description: "ID del link de pago" })
  @ApiResponse({ status: 200, description: "Link cancelado." })
  @ApiAuthErrors()
  @ApiNotFound("El link de pago")
  cancel(@CurrentUser() user: AuthUser, @Param("linkId") linkId: string) {
    return this.svc.cancel(linkId, user.tenantId!);
  }

  @Patch(":linkId/mark-paid")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Marcar link de pago como cobrado",
    description:
      "Admin/kitchen. Registra el método con el que se cobró y cierra el link. " +
      "Útil para pagos en efectivo o transferencias confirmadas fuera de banda.",
  })
  @ApiParam({ name: "linkId", description: "ID del link de pago" })
  @ApiResponse({ status: 200, description: "Link marcado como pagado." })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFound("El link de pago")
  markPaid(
    @CurrentUser() user: AuthUser,
    @Param("linkId") linkId: string,
    @Body() dto: MarkPaidDto,
    @TraceId() traceId: string,
  ) {
    return this.svc.markPaid(linkId, user.tenantId!, dto, traceId);
  }
}

@ApiTags("Payment Links")
@Controller(":tenantSlug/pago")
export class PaymentLinkPublicController {
  constructor(private svc: PaymentLinkService) {}

  @Get(":linkId")
  @ApiOperation({
    summary: "Ver link de pago (público)",
    description:
      "Sin auth. El cliente accede desde el link compartido para ver el monto y pagar. " +
      "Devuelve 404 si el link no existe o fue cancelado.",
  })
  @ApiParam({ name: "tenantSlug", example: "la-hamburgueseria" })
  @ApiParam({ name: "linkId", description: "ID del link de pago" })
  @ApiResponse({ status: 200, description: "Datos del link de pago." })
  @ApiNotFound("El link de pago")
  getPublic(@Param("linkId") linkId: string) {
    return this.svc.getPublic(linkId);
  }

  @Post(":linkId/upload-receipt")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiOperation({
    summary: "Subir comprobante PagoMóvil del link",
    description:
      "Endpoint público. El cliente sube la imagen ANTES de PATCH /pagomovil. " +
      "Sube a Cloudinary y guarda la URL en el link. " +
      "Mimes: image/png, image/jpeg, image/webp. Máx 5 MB.",
  })
  @ApiParam({ name: "tenantSlug", example: "la-hamburgueseria" })
  @ApiParam({ name: "linkId", description: "ID del link de pago" })
  @ApiResponse({ status: 201, description: "{ url: string }" })
  @ApiResponse({
    status: 400,
    description: "Archivo faltante o mime no soportado.",
  })
  @ApiResponse({ status: 503, description: "Cloudinary no configurado." })
  uploadReceipt(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("linkId") linkId: string,
    @UploadedFile() file: Express.Multer.File,
    @TraceId() traceId: string,
  ) {
    assertValidImageFile(file);
    return this.svc.attachReceipt(linkId, tenantSlug, file.buffer, traceId);
  }

  @Patch(":linkId/pagomovil")
  @ApiOperation({
    summary: "Confirmar pago PagoMóvil del link",
    description:
      "Endpoint público. El cliente envía referencia + teléfono + monto en Bs + URL " +
      "del comprobante. El link transiciona `active → pending_verification`. El admin " +
      "debe revisar y aprobar (mark-paid) o cancelar.",
  })
  @ApiParam({ name: "tenantSlug", example: "la-hamburgueseria" })
  @ApiParam({ name: "linkId", description: "ID del link de pago" })
  @ApiResponse({ status: 200, description: "Link en pending_verification." })
  @ApiResponse({
    status: 400,
    description: "Link en estado no submittable o validación falló.",
  })
  @ApiValidationError()
  @ApiNotFound("El link de pago")
  submitPagomovil(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("linkId") linkId: string,
    @Body() dto: SubmitPaymentLinkPagomovilDto,
    @TraceId() traceId: string,
  ) {
    return this.svc.submitPagomovil(linkId, tenantSlug, dto, traceId);
  }

  @Patch(":linkId/transfer")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirmar pago por transferencia bancaria",
    description:
      "Endpoint público. El cliente sube el comprobante y los datos de la transferencia. " +
      "El link transiciona `active → pending_verification`. El admin debe revisar y aprobar.",
  })
  @ApiParam({ name: "tenantSlug", example: "la-hamburgueseria" })
  @ApiParam({ name: "linkId", description: "ID del link de pago" })
  @ApiResponse({ status: 200, description: "Link en pending_verification." })
  @ApiResponse({
    status: 400,
    description: "Link en estado no submittable o validación falló.",
  })
  @ApiValidationError()
  @ApiNotFound("El link de pago")
  submitTransfer(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("linkId") linkId: string,
    @Body() dto: SubmitTransferDto,
    @TraceId() traceId: string,
  ) {
    return this.svc.submitTransfer(linkId, tenantSlug, dto, traceId);
  }

  @Patch(":linkId/zelle")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Confirmar pago por Zelle",
    description:
      "Endpoint público. El cliente sube el comprobante y los datos del pago Zelle. " +
      "El link transiciona `active → pending_verification`. El admin debe revisar y aprobar.",
  })
  @ApiParam({ name: "tenantSlug", example: "la-hamburgueseria" })
  @ApiParam({ name: "linkId", description: "ID del link de pago" })
  @ApiResponse({ status: 200, description: "Link en pending_verification." })
  @ApiResponse({
    status: 400,
    description: "Link en estado no submittable o validación falló.",
  })
  @ApiValidationError()
  @ApiNotFound("El link de pago")
  submitZelle(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("linkId") linkId: string,
    @Body() dto: SubmitZelleDto,
    @TraceId() traceId: string,
  ) {
    return this.svc.submitZelle(linkId, tenantSlug, dto, traceId);
  }
}
