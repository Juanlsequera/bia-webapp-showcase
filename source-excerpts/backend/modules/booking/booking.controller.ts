import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  UseGuards,
  NotFoundException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
  ApiBody,
} from "@nestjs/swagger";
import { BookingService } from "./booking.service";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { Roles } from "../auth/decorators/roles.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { OptionalJwtGuard } from "../auth/guards/optional-jwt.guard";
import { TenantService } from "../tenant/tenant.service";
import { OrdersGateway } from "../gateway/orders.gateway";
import { CreateStaffDto } from "./dto/create-staff.dto";
import { UpdateStaffDto } from "./dto/update-staff.dto";
import { AuthUser, SocketEvent } from "@foodorder/types";
import {
  ApiAuthErrors,
  ApiValidationError,
  ApiNotFound,
} from "../../common/decorators/api-errors.decorator";
import { ModuleEnabledGuard } from "../tenant/guards/module-enabled.guard";
import { RequireModule } from "../tenant/decorators/require-module.decorator";
import { Throttle } from "@nestjs/throttler";

@ApiTags("Booking")
@Controller()
export class BookingController {
  constructor(
    private readonly bookingService: BookingService,
    private readonly tenantService: TenantService,
    private readonly gateway: OrdersGateway,
  ) {}

  // ─── PUBLIC ENDPOINTS ──────────────────────────────────────────────────────────

  /** GET /:tenantSlug/staff?serviceId=... — Lista de profesionales activos */
  @Get(":tenantSlug/staff")
  @ApiOperation({
    summary: "Listar profesionales activos del tenant",
    description:
      "Público (sin auth). Devuelve el staff disponible para reservas. " +
      "Filtrable por `serviceId` para mostrar solo quiénes ofrecen ese servicio.",
  })
  @ApiParam({ name: "tenantSlug", example: "mi-peluqueria" })
  @ApiQuery({
    name: "serviceId",
    required: false,
    description: "ObjectId del servicio para filtrar staff",
  })
  @ApiResponse({
    status: 200,
    description: "Lista de profesionales.",
    schema: {
      example: [
        {
          _id: "...",
          name: "Ana García",
          bio: "Estilista",
          avatar_url: null,
          serviceIds: ["..."],
        },
      ],
    },
  })
  @ApiNotFound("El tenant")
  async getStaff(
    @Param("tenantSlug") slug: string,
    @Query("serviceId") serviceId?: string,
  ) {
    const tenant = await this.tenantService.findBySlug(slug);
    if (!tenant) {
      throw new NotFoundException(`Tenant '${slug}' not found`);
    }
    return this.bookingService.getStaffForService(
      tenant._id.toString(),
      serviceId,
    );
  }

  /**
   * GET /:tenantSlug/availability/calendar?month=2026-07&serviceId=<id>&staffId=<id>
   * Retorna los días del mes con al menos 1 slot libre.
   * IMPORTANTE: debe declararse ANTES de /availability para que NestJS no confunda la ruta.
   */
  @Get(":tenantSlug/availability/calendar")
  @ApiOperation({
    summary: "Días con disponibilidad en un mes",
    description:
      "Público (sin auth). Retorna los días del mes que tienen al menos 1 slot libre. " +
      "Si staffId no se provee, comprueba todos los staff activos del tenant (unión).",
  })
  @ApiParam({ name: "tenantSlug", example: "mi-peluqueria" })
  @ApiQuery({
    name: "month",
    required: true,
    description: "Mes en formato YYYY-MM",
    example: "2026-07",
  })
  @ApiQuery({
    name: "serviceId",
    required: false,
    description: "ObjectId del servicio",
  })
  @ApiQuery({
    name: "staffId",
    required: false,
    description: "ObjectId del profesional (omitir = todos)",
  })
  @ApiQuery({
    name: "serviceDuration",
    required: false,
    description: "Duración del servicio en minutos (default 60)",
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: { availableDates: ["2026-07-05", "2026-07-06", "2026-07-07"] },
    },
  })
  @ApiNotFound("El tenant")
  async getCalendarAvailability(
    @Param("tenantSlug") slug: string,
    @Query("month") month: string,
    @Query("serviceId") serviceId?: string,
    @Query("staffId") staffId?: string,
    @Query("serviceDuration") serviceDuration?: string,
  ) {
    const tenant = await this.tenantService.findBySlug(slug);
    if (!tenant) throw new NotFoundException(`Tenant '${slug}' not found`);

    const [yearStr, monStr] = (month ?? "").split("-");
    const year = parseInt(yearStr, 10);
    const mon = parseInt(monStr, 10);
    if (!year || !mon || mon < 1 || mon > 12) {
      throw new NotFoundException("month debe tener formato YYYY-MM");
    }

    const timezone = tenant.schedule?.timezone ?? "UTC";
    const duration = serviceDuration ? parseInt(serviceDuration, 10) : 60;

    const availableDates = await this.bookingService.getCalendarAvailability(
      tenant._id.toString(),
      year,
      mon,
      serviceId,
      staffId,
      timezone,
      duration,
    );

    return { availableDates };
  }

  /** GET /:tenantSlug/availability?staffId=...&date=...&serviceDuration=...&serviceId=... */
  @Get(":tenantSlug/availability")
  @ApiOperation({
    summary: "Slots de disponibilidad de un profesional",
    description:
      "Público (sin auth). Devuelve los horarios disponibles en una fecha. " +
      "Si staffId se omite, retorna la unión de slots de todos los staff activos e incluye assignedStaffId por slot.",
  })
  @ApiParam({ name: "tenantSlug", example: "mi-peluqueria" })
  @ApiQuery({
    name: "staffId",
    required: false,
    description: "ObjectId del profesional (omitir = sin preferencia)",
  })
  @ApiQuery({
    name: "serviceId",
    required: false,
    description: "ObjectId del servicio (para filtrar staff)",
  })
  @ApiQuery({
    name: "date",
    required: true,
    description: "Fecha en formato YYYY-MM-DD",
    example: "2026-06-15",
  })
  @ApiQuery({
    name: "serviceDuration",
    required: false,
    description: "Duración del servicio en minutos (default 60)",
  })
  @ApiResponse({
    status: 200,
    description: "Array de slots disponibles.",
    schema: {
      example: [
        { time: "09:00", available: true },
        { time: "09:30", available: false },
        { time: "10:00", available: true },
      ],
    },
  })
  @ApiNotFound("El tenant")
  async getAvailability(
    @Param("tenantSlug") slug: string,
    @Query("staffId") staffId: string | undefined,
    @Query("date") date: string,
    @Query("serviceDuration") serviceDuration?: string,
    @Query("serviceId") serviceId?: string,
  ) {
    const tenant = await this.tenantService.findBySlug(slug);
    if (!tenant) {
      throw new NotFoundException(`Tenant '${slug}' not found`);
    }

    const duration = serviceDuration ? parseInt(serviceDuration, 10) : 60;
    const timezone = tenant.schedule?.timezone ?? "UTC";

    // Sin preferencia de profesional: unión de disponibilidad de todos los staff
    if (!staffId) {
      const result = await this.bookingService.getAvailableSlotsForAnyStaff(
        tenant._id.toString(),
        date,
        duration,
        serviceId,
        timezone,
      );
      return result.slots;
    }

    const result = await this.bookingService.getAvailableSlots(
      tenant._id.toString(),
      staffId,
      date,
      duration,
      timezone,
    );
    return result.slots;
  }

  // ─── ADMIN ENDPOINTS ───────────────────────────────────────────────────────────

  /** GET /admin/staff — Listar todos los profesionales del tenant */
  @Get("admin/staff")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin")
  @RequireModule("booking")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Listar todos los profesionales del tenant (admin)",
  })
  @ApiResponse({ status: 200, description: "Array de profesionales." })
  @ApiAuthErrors()
  async listStaff(@CurrentUser() user: AuthUser) {
    return this.bookingService.list(user.tenantId!);
  }

  /** POST /admin/staff — Crear nuevo profesional */
  @Post("admin/staff")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin")
  @RequireModule("booking")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Crear nuevo profesional",
    description:
      "Admin-only. Crea un profesional con nombre, bio, avatar y horario semanal.",
  })
  @ApiResponse({ status: 201, description: "Profesional creado." })
  @ApiValidationError()
  @ApiAuthErrors()
  async createStaff(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateStaffDto,
  ) {
    return this.bookingService.create(user.tenantId!, dto);
  }

  /** PATCH /admin/staff/:id — Actualizar profesional */
  @Patch("admin/staff/:id")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin")
  @RequireModule("booking")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Actualizar datos de un profesional" })
  @ApiParam({ name: "id", description: "ObjectId del profesional" })
  @ApiResponse({ status: 200, description: "Profesional actualizado." })
  @ApiValidationError()
  @ApiAuthErrors()
  @ApiNotFound("El profesional")
  async updateStaff(
    @CurrentUser() user: AuthUser,
    @Param("id") id: string,
    @Body() dto: UpdateStaffDto,
  ) {
    return this.bookingService.update(user.tenantId!, id, dto);
  }

  /** DELETE /admin/staff/:id — Eliminar profesional */
  @Delete("admin/staff/:id")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin")
  @RequireModule("booking")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Eliminar un profesional" })
  @ApiParam({ name: "id", description: "ObjectId del profesional" })
  @ApiResponse({ status: 200, description: "{ success: true }" })
  @ApiAuthErrors()
  @ApiNotFound("El profesional")
  async removeStaff(@CurrentUser() user: AuthUser, @Param("id") id: string) {
    await this.bookingService.remove(user.tenantId!, id);
    return { success: true };
  }

  /** GET /admin/bookings?date=... — Ver bookings de un día específico */
  @Get("admin/bookings")
  @UseGuards(JwtAuthGuard, RolesGuard, ModuleEnabledGuard)
  @Roles("admin")
  @RequireModule("booking")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Listar citas de un día (admin)",
    description:
      "Admin-only. Devuelve todas las reservas del tenant para la fecha indicada.",
  })
  @ApiQuery({
    name: "date",
    required: true,
    description: "Fecha en formato YYYY-MM-DD",
    example: "2026-06-15",
  })
  @ApiResponse({ status: 200, description: "Array de citas del día." })
  @ApiAuthErrors()
  async getBookings(
    @CurrentUser() user: AuthUser,
    @Query("date") date: string,
  ) {
    return this.bookingService.getBookingsByDate(user.tenantId!, date);
  }

  /** POST /:tenantSlug/orders/:id/reschedule — Reprogramar una cita */
  @Post(":tenantSlug/orders/:id/reschedule")
  // SEC-01: OptionalJwtGuard → si hay JWT de admin, req.user queda seteado (admin bypass del token).
  // Anti-abuse: máx 5 intentos por minuto por IP (endpoint público sin auth)
  @UseGuards(OptionalJwtGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: "Reprogramar una cita",
    description:
      "Público (sin auth) o admin (JWT). Cambia el profesional y/o la fecha+hora de una cita existente. " +
      "Sin auth, requiere `cancellation_token` del email de confirmación. " +
      "Emite evento WebSocket al admin para actualizar el calendario en tiempo real.",
  })
  @ApiParam({ name: "tenantSlug", example: "mi-peluqueria" })
  @ApiParam({ name: "id", description: "ObjectId de la orden / cita" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        staffId: {
          type: "string",
          description: "ObjectId del nuevo profesional",
        },
        bookingDatetime: {
          type: "string",
          format: "date-time",
          example: "2026-06-20T10:00:00.000Z",
        },
        cancellation_token: {
          type: "string",
          description:
            "Token de cancelación recibido por email (requerido si no hay JWT de admin)",
        },
      },
      required: ["staffId", "bookingDatetime"],
    },
  })
  @ApiResponse({
    status: 201,
    description: "Cita reprogramada.",
    schema: {
      example: { success: true, message: "Cita reprogramada", order: {} },
    },
  })
  @ApiResponse({
    status: 400,
    description: "El slot ya no está disponible (anti double-booking).",
  })
  @ApiResponse({ status: 403, description: "Token de cancelación inválido." })
  @ApiNotFound("El tenant o la cita")
  async rescheduleBooking(
    @CurrentUser() user: AuthUser | undefined,
    @Param("tenantSlug") slug: string,
    @Param("id") orderId: string,
    @Body("staffId") staffId: string,
    @Body("bookingDatetime") bookingDatetime: string,
    @Body("cancellation_token") cancellationToken?: string,
  ) {
    const tenant = await this.tenantService.findBySlug(slug);
    if (!tenant) {
      throw new NotFoundException(`Tenant '${slug}' not found`);
    }

    // SEC-01: si hay JWT de admin/kitchen → admin bypass (undefined = skip token check)
    const tokenArg = user ? undefined : cancellationToken;

    const updated = await this.bookingService.rescheduleBooking(
      tenant._id.toString(),
      orderId,
      staffId,
      bookingDatetime,
      tokenArg,
    );

    const tenantId = tenant._id.toString();
    const payload = {
      orderId,
      status: "rescheduled",
      bookingDatetime: updated.bookingDatetime,
      staffId: updated.staffId,
    };
    this.gateway.emitToAdmin(
      tenantId,
      SocketEvent.ORDER_STATUS_CHANGED,
      payload,
    );
    this.gateway.emitToOrder(
      tenantId,
      orderId,
      SocketEvent.ORDER_STATUS_CHANGED,
      payload,
    );

    return { success: true, message: "Cita reprogramada", order: updated };
  }

  /** POST /:tenantSlug/orders/:id/cancel-booking — Cancelar una cita */
  @Post(":tenantSlug/orders/:id/cancel-booking")
  // SEC-01: OptionalJwtGuard → si hay JWT de admin, req.user queda seteado (admin bypass del token).
  // Anti-abuse: máx 5 intentos por minuto por IP (endpoint público sin auth)
  @UseGuards(OptionalJwtGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: "Cancelar una cita",
    description:
      "Público (sin auth) o admin (JWT). Cancela la cita y emite evento WebSocket al admin. " +
      "Sin auth, requiere `cancellation_token` del email de confirmación. " +
      "El campo `reason` es opcional pero recomendado para auditoría.",
  })
  @ApiParam({ name: "tenantSlug", example: "mi-peluqueria" })
  @ApiParam({ name: "id", description: "ObjectId de la orden / cita" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Motivo de cancelación (opcional)",
          example: "Cliente no puede asistir",
        },
        cancellation_token: {
          type: "string",
          description:
            "Token de cancelación recibido por email (requerido si no hay JWT de admin)",
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: "Cita cancelada.",
    schema: {
      example: { success: true, message: "Cita cancelada", order: {} },
    },
  })
  @ApiResponse({ status: 403, description: "Token de cancelación inválido." })
  @ApiNotFound("El tenant o la cita")
  async cancelBooking(
    @CurrentUser() user: AuthUser | undefined,
    @Param("tenantSlug") slug: string,
    @Param("id") orderId: string,
    @Body("reason") reason?: string,
    @Body("cancellation_token") cancellationToken?: string,
  ) {
    const tenant = await this.tenantService.findBySlug(slug);
    if (!tenant) {
      throw new NotFoundException(`Tenant '${slug}' not found`);
    }

    // SEC-01: si hay JWT de admin/kitchen → admin bypass (undefined = skip token check)
    const tokenArg = user ? undefined : cancellationToken;

    const updated = await this.bookingService.cancelBooking(
      tenant._id.toString(),
      orderId,
      reason,
      tokenArg,
    );

    const tenantId = tenant._id.toString();
    const payload = { orderId, status: "cancelled", reason };
    this.gateway.emitToAdmin(
      tenantId,
      SocketEvent.ORDER_STATUS_CHANGED,
      payload,
    );
    this.gateway.emitToOrder(
      tenantId,
      orderId,
      SocketEvent.ORDER_STATUS_CHANGED,
      payload,
    );

    return { success: true, message: "Cita cancelada", order: updated };
  }
}
