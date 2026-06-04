import {
  Controller,
  Post,
  Patch,
  Get,
  Param,
  Body,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { OrderService } from "./order.service";
import {
  CreateOrderDto,
  SubmitPagomovilDto,
  VerifyPagomovilDto,
  UpdateOrderStatusDto,
  ConfirmCashPaymentDto,
  SubmitQuoteDto,
} from "./dto/order.dto";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthUser } from "@foodorder/types";
import {
  ApiAuthErrors,
  ApiValidationError,
  ApiNotFound,
  ApiTenantForbidden,
} from "../../common/decorators/api-errors.decorator";
import { TraceId } from "../../common/decorators/trace-id.decorator";
import { ParseSlugPipe } from "../../common/pipes/parse-slug.pipe";
import { assertValidImageFile } from "../../common/utils/validate-image";
import { ModuleEnabledGuard } from "../tenant/guards/module-enabled.guard";
import { RequireModule } from "../tenant/decorators/require-module.decorator";

@Controller()
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  // ── Rutas públicas (cliente sin auth) ──────────────────────────────

  @Post(":tenantSlug/orders")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiTags("Orders (cliente)")
  @ApiOperation({
    summary: "Crear orden desde el cliente",
    description:
      "Endpoint público (cliente sin auth). Se ejecuta al confirmar el carrito o la reserva. " +
      "El total se calcula server-side desde `Product.price` — NO se confía en el payload. " +
      "Estado inicial: `cash → pending_cash`, `pagomovil/stripe/mercadopago → confirmed`.",
  })
  @ApiParam({ name: "tenantSlug", example: "la-hamburgueseria" })
  @ApiResponse({
    status: 201,
    description: "Orden creada con total real calculado server-side.",
  })
  @ApiResponse({
    status: 400,
    description:
      "Payload inválido, algún `productId` no existe o está inactivo, o `items` vacío.",
  })
  @ApiNotFound("El tenant")
  createOrder(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Body() dto: CreateOrderDto,
    @TraceId() traceId: string,
  ) {
    return this.orderService.createOrder(tenantSlug, dto, traceId);
  }

  @Post(":tenantSlug/orders/:orderId/upload-receipt")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: 5 * 1024 * 1024 } }),
  )
  @ApiTags("Orders (cliente)")
  @ApiOperation({
    summary: "Subir screenshot del comprobante PagoMóvil",
    description:
      "Endpoint público. El cliente sube la imagen ANTES de PATCH /pagomovil. " +
      "Persiste la URL en Cloudinary y la guarda en la orden. " +
      "Mimes aceptados: image/png, image/jpeg, image/webp. Máximo 5 MB. " +
      "Si CLOUDINARY no está configurado devuelve 503.",
  })
  @ApiParam({ name: "tenantSlug", example: "la-hamburgueseria" })
  @ApiParam({ name: "orderId", description: "ObjectId de la orden" })
  @ApiResponse({ status: 201, description: "{ url: string }" })
  @ApiResponse({
    status: 400,
    description: "Archivo faltante o mime no soportado.",
  })
  @ApiResponse({ status: 503, description: "Cloudinary no configurado." })
  uploadReceipt(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("orderId") orderId: string,
    @UploadedFile() file: Express.Multer.File,
    @TraceId() traceId: string,
  ) {
    // Valida mime declarado + magic bytes reales (anti-spoofing de extension).
    assertValidImageFile(file);
    return this.orderService.attachReceipt(
      orderId,
      tenantSlug,
      file.buffer,
      traceId,
    );
  }

  @Patch(":tenantSlug/orders/:orderId/pagomovil")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiTags("Orders (cliente)")
  @ApiOperation({
    summary: "Enviar comprobante de PagoMóvil",
    description:
      "Cliente carga los datos del comprobante tras hacer la transferencia. " +
      "Transición: `confirmed → pending_verification`. " +
      "A partir de acá el admin debe verificar manualmente.",
  })
  @ApiParam({ name: "tenantSlug", example: "la-hamburgueseria" })
  @ApiParam({ name: "orderId", description: "ObjectId de la orden" })
  @ApiResponse({
    status: 200,
    description: "Datos cargados. Orden queda en `pending_verification`.",
  })
  @ApiResponse({
    status: 400,
    description:
      "La orden no usa PagoMóvil, o su `payment.status` ya no es `pending` " +
      "(ya enviada o aprobada).",
  })
  @ApiTenantForbidden()
  @ApiValidationError()
  @ApiNotFound("La comanda")
  submitPagomovil(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("orderId") orderId: string,
    @Body() dto: SubmitPagomovilDto,
    @TraceId() traceId: string,
  ) {
    return this.orderService.submitPagomovil(orderId, tenantSlug, dto, traceId);
  }

  // Rate limit "relaxed" (120/min): el OrderStatusPage pollea cada 20s
  // = 3/min, pero cuando llega un evento WS también invalida la query y
  // refetcha. Con varias mesas detrás del mismo NAT del local tocaríamos
  // el default (30/min) muy rápido. Cuando llegue P1.15 (Web Push) y
  // desaparezca el polling, esto se puede bajar al default.
  @Get(":tenantSlug/orders/:orderId/status")
  @Throttle({ relaxed: { ttl: 60_000, limit: 300 } }) // polling cada 30s + Web Push activo → 300/min holgado
  @ApiTags("Orders (cliente)")
  @ApiOperation({
    summary: "Consultar estado de la orden",
    description:
      "Endpoint público usado hoy por el `OrderStatusPage` para polling. " +
      "Cuando implementemos Web Push (P1.15) este polling desaparece.",
  })
  @ApiParam({ name: "tenantSlug", example: "la-hamburgueseria" })
  @ApiParam({ name: "orderId", description: "ObjectId de la orden" })
  @ApiResponse({
    status: 200,
    description: "Estado resumido de la comanda.",
    schema: {
      example: {
        orderId: "6620f14c1a9e3a2b4c8d5678",
        tenantId: "6620f14c1a9e3a2b4c8d0000",
        status: "preparing",
        paymentStatus: "approved",
        tableNumber: 5,
        total: 17,
        pricing: {
          total_usd: 17,
          usd_rate: 36.42,
          rate_captured_at: "2026-04-25T13:00:00.000Z",
          total_bs: 619.14,
          rate_stale: false,
        },
        rejectionReason: null,
        traceId: "a1b2c3d4",
      },
    },
  })
  @ApiTenantForbidden()
  @ApiNotFound("La comanda")
  getOrderStatus(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("orderId") orderId: string,
  ) {
    return this.orderService.getOrderStatus(orderId, tenantSlug);
  }

  // ── Rutas del admin (requieren JWT admin) ──────────────────────────

  @Get("admin/orders/pending-verification")
  @ApiTags("Orders (admin)")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Órdenes esperando verificación de PagoMóvil",
    description:
      "Admin-only. Vista principal del dashboard para aprobar/rechazar pagos. " +
      "Devuelve array ordenado por `createdAt` ASC (más antiguas primero).",
  })
  @ApiResponse({
    status: 200,
    description: "Array de órdenes en `pending_verification`.",
  })
  @ApiAuthErrors()
  getPendingVerification(@CurrentUser() user: AuthUser) {
    return this.orderService.getPendingVerification(user.tenantId!);
  }

  @Patch("admin/orders/:orderId/verify-pagomovil")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiTags("Orders (admin)")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Aprobar o rechazar un PagoMóvil",
    description:
      "Admin-only. Transición:\n" +
      "- `approved` → status `paid`, payment `approved`, setea `paidAt` y `pagomovil_verified_by/at`.\n" +
      "- `rejected` → status `cancelled`, payment `rejected`, registra `rejection_reason`.\n\n" +
      "La misma lógica será usada por el webhook del agregador en Fase 2 — no cambia nada " +
      "para cocina ni cliente.",
  })
  @ApiParam({ name: "orderId", description: "ObjectId de la orden" })
  @ApiResponse({ status: 200, description: "Orden actualizada." })
  @ApiResponse({
    status: 400,
    description:
      "La orden no está esperando verificación (payment.status ≠ pending_verification).",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiTenantForbidden()
  @ApiNotFound("La comanda")
  verifyPagomovil(
    @Param("orderId") orderId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: VerifyPagomovilDto,
    @TraceId() traceId: string,
  ) {
    return this.orderService.verifyPagomovil(
      orderId,
      user.tenantId!,
      user.email,
      dto,
      traceId,
    );
  }

  @Get("admin/orders/pending-cash")
  @ApiTags("Orders (admin)")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "kitchen")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Órdenes esperando cobro en efectivo",
    description:
      "Admin o kitchen. Vista del cajero: muestra todas las órdenes en `pending_cash` " +
      "ordenadas por antigüedad, listas para confirmar el cobro.",
  })
  @ApiResponse({
    status: 200,
    description: "Array de órdenes en `pending_cash`.",
  })
  @ApiAuthErrors()
  getPendingCash(@CurrentUser() user: AuthUser) {
    return this.orderService.getPendingCash(user.tenantId!);
  }

  @Post("admin/orders/:orderId/confirm-cash")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiTags("Orders (admin)")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Confirmar cobro en efectivo",
    description:
      "Solo admin. Transición `pending_cash → paid` + `payment.status=approved`. " +
      "Registra el `email` del operador en `confirmed_by` para auditoría. " +
      "Sólo funciona si la orden tiene `payment.method=cash` y `status=pending_cash`.",
  })
  @ApiParam({ name: "orderId", description: "ObjectId de la orden" })
  @ApiResponse({
    status: 201,
    description: "Cobro confirmado, orden lista para procesamiento.",
  })
  @ApiResponse({
    status: 400,
    description:
      "La orden no es efectivo, o su status no es `pending_cash` (ya cobrada o cancelada).",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiTenantForbidden()
  @ApiNotFound("La comanda")
  confirmCashPayment(
    @Param("orderId") orderId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: ConfirmCashPaymentDto,
    @TraceId() traceId: string,
  ) {
    return this.orderService.confirmCashPayment(
      orderId,
      user.tenantId!,
      user.email,
      dto,
      traceId,
    );
  }

  @Post("admin/orders/expire-stale")
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @ApiTags("Orders (admin)")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Expirar órdenes PagoMóvil abandonadas (BUG-05)",
    description:
      "Admin-only. Cancela las órdenes en `pending_verification` sin verificar hace " +
      "más de 30 min, restaura su stock y limpia el comprobante. El barrido también " +
      "corre automáticamente en background, pero este endpoint es el fallback manual / " +
      "para disparar desde un cron externo (útil porque Render free tier duerme).",
  })
  @ApiResponse({
    status: 201,
    description: "{ expired: number } — cantidad de órdenes canceladas.",
  })
  @ApiAuthErrors()
  expireStaleOrders(@CurrentUser() user: AuthUser) {
    return this.orderService.expireStaleOrders(30, user.tenantId!);
  }

  // ── Rutas de servicios / cotizaciones (admin) ─────────────────────

  @Get("admin/orders/service")
  @ApiTags("Orders (admin)")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin")
  @RequireModule("quotes_estimates")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Listar solicitudes de servicio (archetype=service)",
    description:
      "Admin. Devuelve las últimas 200 órdenes de archetype=service del tenant, " +
      "ordenadas por fecha descendente. Incluye quote_amount y quote_notes.",
  })
  @ApiResponse({ status: 200, description: "Array de órdenes service." })
  @ApiAuthErrors()
  getServiceOrders(@CurrentUser() user: AuthUser) {
    return this.orderService.getServiceOrders(user.tenantId!);
  }

  @Patch("admin/orders/:orderId/quote")
  @ApiTags("Orders (admin)")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin")
  @RequireModule("quotes_estimates")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Enviar cotización al cliente (inquiry → quoted)",
    description:
      "Admin. Requiere que la orden esté en status `inquiry`. " +
      "Setea `quote_amount` y `quote_notes`, transiciona a `quoted` y emite evento WS.",
  })
  @ApiParam({ name: "orderId", description: "ObjectId de la comanda" })
  @ApiResponse({
    status: 200,
    description: "Orden actualizada con la cotización.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFound("La comanda")
  submitQuote(
    @Param("orderId") orderId: string,
    @Body() dto: SubmitQuoteDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.orderService.submitQuote(orderId, dto, user);
  }

  /**
   * PATCH /admin/orders/:orderId/status
   *
   * Endpoint exclusivo para transiciones de estado en cotizaciones/servicios.
   * Requiere módulo `quotes_estimates` (no `kitchen_kds`) para que funcione
   * en tenants service que no tienen el KDS de cocina activo.
   *
   * Transiciones válidas para archetype=service:
   *   approved → in_progress → completed | cancelled
   *   quoted → cancelled
   */
  @Patch("admin/orders/:orderId/status")
  @ApiTags("Orders (admin)")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin")
  @RequireModule("quotes_estimates")
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Cambiar estado de una cotización / servicio (admin)",
    description:
      "Admin. Transiciones de estado para órdenes de archetype=service. " +
      "No requiere `kitchen_kds` — usa el módulo `quotes_estimates`. " +
      "Transiciones válidas: approved→in_progress, in_progress→completed, quoted|approved→cancelled.",
  })
  @ApiParam({
    name: "orderId",
    description: "ObjectId de la orden de servicio",
  })
  @ApiResponse({ status: 200, description: "Orden actualizada." })
  @ApiResponse({ status: 400, description: "Transición de estado inválida." })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFound("La orden")
  updateServiceOrderStatus(
    @Param("orderId") orderId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOrderStatusDto,
    @TraceId() traceId: string,
  ) {
    return this.orderService.updateStatus(
      orderId,
      user.tenantId!,
      user.email,
      dto,
      traceId,
    );
  }

  // ── Rutas de cocina (requieren JWT kitchen o admin) ────────────────

  @Get("kitchen/orders")
  @ApiTags("Orders (kitchen)")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin", "kitchen")
  @RequireModule("kitchen_kds")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Órdenes activas (panel de operación)",
    description:
      "Admin o kitchen. Devuelve órdenes en `paid | preparing | ready` ordenadas por " +
      "antigüedad (más antigua arriba). Válido para todos los arquetipos — en food es el panel de cocina, " +
      "en booking es el panel de citas del día, en services es la lista de trabajos activos.",
  })
  @ApiResponse({ status: 200, description: "Array de órdenes activas." })
  @ApiAuthErrors()
  getActiveOrders(@CurrentUser() user: AuthUser) {
    return this.orderService.getActiveOrders(user.tenantId!);
  }

  @Patch("kitchen/orders/:orderId/status")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiTags("Orders (kitchen)")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin", "kitchen")
  @RequireModule("kitchen_kds")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Cambiar estado de la orden",
    description:
      "Admin o kitchen. Transiciones válidas:\n" +
      "- `paid → preparing | cancelled`\n" +
      "- `preparing → ready | cancelled`\n" +
      "- `ready → delivered`\n" +
      "- `delivered` y `cancelled` son terminales.\n\n" +
      "Transiciones inválidas devuelven 400.",
  })
  @ApiParam({ name: "orderId", description: "ObjectId de la orden" })
  @ApiResponse({ status: 200, description: "Orden actualizada." })
  @ApiResponse({ status: 400, description: "Transición de estado inválida." })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiTenantForbidden()
  @ApiNotFound("La comanda")
  updateStatus(
    @Param("orderId") orderId: string,
    @CurrentUser() user: AuthUser,
    @Body() dto: UpdateOrderStatusDto,
    @TraceId() traceId: string,
  ) {
    return this.orderService.updateStatus(
      orderId,
      user.tenantId!,
      user.email,
      dto,
      traceId,
    );
  }
}
