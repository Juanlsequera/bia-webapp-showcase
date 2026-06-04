import { Controller, Get, Query, UseGuards, Param, Res } from "@nestjs/common";
import { Response } from "express";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiProduces,
} from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";
import { AnalyticsService } from "./analytics.service";
import { AnalyticsQueryDto, OrdersQueryDto } from "./dto/analytics.dto";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthUser } from "@foodorder/types";
import {
  ApiAuthErrors,
  ApiValidationError,
} from "../../common/decorators/api-errors.decorator";
import { ModuleEnabledGuard } from "../tenant/guards/module-enabled.guard";
import { RequireModule } from "../tenant/decorators/require-module.decorator";

/**
 * Analytics endpoints.
 *
 * Rutas admin (alcance = su propio tenant, extraído del JWT):
 *   GET /analytics/summary
 *   GET /analytics/products
 *   GET /analytics/revenue-by-day
 *   GET /analytics/orders                 ← paginado
 *   GET /analytics/export.csv             ← descarga CSV con BOM UTF-8
 *
 * Ruta superadmin (alcance = tenant arbitrario):
 *   GET /analytics/:tenantId/summary
 *
 * Todas las métricas se calculan sólo sobre pedidos con `payment.status=approved`.
 */
@ApiTags("Analytics")
@ApiBearerAuth("jwt")
@Controller("analytics")
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  // ── Admin del tenant ──────────────────────────────────────────────────

  @Get("summary")
  @Roles("admin")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: "Resumen del período (admin)",
    description:
      "Devuelve totalOrders, totalRevenue, averageTicket, topProduct y periodLabel. " +
      "Sólo cuenta comandas con `payment.status=approved`. " +
      "Default si no se pasa rango: últimos 30 días.",
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        totalOrders: 42,
        totalRevenue: 357.5,
        averageTicket: 8.51,
        topProduct: "Hamburguesa Clásica",
        periodLabel: "2026-03-21 → 2026-04-20",
      },
    },
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getSummary(@CurrentUser() user: AuthUser, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getSummary(user.tenantId!, query);
  }

  @Get("products")
  @Roles("admin")
  @ApiOperation({
    summary: "Ranking de productos más vendidos",
    description:
      "Array ordenado por `totalRevenue` DESC, luego `totalQuantity` DESC.",
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: [
        {
          productId: "6620f14c1a9e3a2b4c8d1234",
          productName: "Hamburguesa Clásica",
          totalQuantity: 35,
          totalRevenue: 297.5,
        },
      ],
    },
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getTopProducts(
    @CurrentUser() user: AuthUser,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getTopProducts(user.tenantId!, query);
  }

  @Get("revenue-by-day")
  @Roles("admin")
  @ApiOperation({
    summary: "Ingresos agrupados por día",
    description:
      "Para el gráfico de barras del dashboard. Ordenado por fecha ASC.",
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: [
        { date: "2026-04-18", revenue: 120.5, orders: 14 },
        { date: "2026-04-19", revenue: 180, orders: 21 },
      ],
    },
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getRevenueByDay(
    @CurrentUser() user: AuthUser,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getRevenueByDay(user.tenantId!, query);
  }

  @Get("orders")
  @Roles("admin")
  @ApiOperation({
    summary: "Historial de comandas (paginado + filtros)",
    description:
      "Listado paginado con filtros por status, método de pago, producto y mesa. " +
      "Ordenado por `createdAt` DESC (más recientes primero).",
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        data: [
          {
            orderId: "6620f14c1a9e3a2b4c8d5678",
            tableNumber: 5,
            total: 17,
            status: "delivered",
            paymentMethod: "pagomovil",
            itemCount: 3,
            createdAt: "2026-04-19T20:15:00.000Z",
          },
        ],
        total: 128,
        page: 1,
        limit: 50,
      },
    },
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getOrders(@CurrentUser() user: AuthUser, @Query() query: OrdersQueryDto) {
    return this.analyticsService.getOrders(user.tenantId!, query);
  }

  @Get("payment-methods")
  @Roles("admin")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: "Breakdown por método de pago",
    description:
      "Total de órdenes y revenue por cada método (pagomovil, cash, etc.).",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getPaymentMethodBreakdown(
    @CurrentUser() user: AuthUser,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getPaymentMethodBreakdown(
      user.tenantId!,
      query,
    );
  }

  @Get("kitchen-times")
  @Roles("admin")
  @UseGuards(ModuleEnabledGuard)
  @RequireModule("advanced_analytics")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: "Tiempos operativos de cocina (food)",
    description:
      "Promedios de paid→ready (cocina), ready→delivered (entrega) y paid→delivered (total). " +
      "Incluye conteo de pedidos críticos (>15min en cocina) y tasa de cancelación. " +
      "Solo cuenta órdenes con archetype=food. `totalMeasurable` indica cuántas del rango " +
      "tienen los timestamps necesarios (las creadas antes del rollout de tracking quedan fuera).",
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        avgPreparingMinutes: 8.3,
        avgDeliveryMinutes: 2.1,
        avgTotalMinutes: 10.4,
        criticalOrders: 3,
        criticalRate: 7.5,
        cancelledOrders: 2,
        cancellationRate: 4.5,
        totalMeasurable: 40,
        totalOrders: 44,
        criticalThresholdMin: 15,
      },
    },
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getKitchenTimes(
    @CurrentUser() user: AuthUser,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getKitchenTimes(user.tenantId!, query);
  }

  @Get("by-hour")
  @Roles("admin")
  @UseGuards(ModuleEnabledGuard)
  @RequireModule("advanced_analytics")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: "Distribución de órdenes por hora del día (UTC)",
    description:
      "Para el gráfico de horas pico. El frontend puede ajustar -4h para VET.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getByHour(@CurrentUser() user: AuthUser, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getByHour(user.tenantId!, query);
  }

  @Get("booking-stats")
  @Roles("admin")
  @UseGuards(ModuleEnabledGuard)
  @RequireModule("booking")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: "Estadísticas de reservas por estado (booking)",
    description:
      "Devuelve un breakdown de reservas por estado (completed, cancelled, no_show, active) " +
      "en el rango de fechas dado. Filtra por archetype=booking, sin restricción de payment.status.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getBookingStats(
    @CurrentUser() user: AuthUser,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getBookingStats(user.tenantId!, query);
  }

  @Get("service-stats")
  @Roles("admin")
  @UseGuards(ModuleEnabledGuard)
  @RequireModule("quotes_estimates")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: "Estadísticas de trabajos por estado (service)",
    description:
      "Devuelve un breakdown de trabajos/cotizaciones por estado (inquiry, quoted, approved, " +
      "in_progress, completed, rejected, cancelled), tasa de conversión y ticket promedio. " +
      "Filtra por archetype=service, sin restricción de payment.status.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getServiceStats(
    @CurrentUser() user: AuthUser,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getServiceStats(user.tenantId!, query);
  }

  @Get("export.csv")
  @Roles("admin")
  @ApiOperation({
    summary: "Exportar historial como CSV (BOM UTF-8)",
    description:
      "Descarga hasta 5000 filas del rango filtrado. CSV con BOM para que Excel lo abra correctamente. " +
      "El frontend llama con `fetch + Authorization`, por eso el server setea " +
      "`Content-Disposition: attachment`.",
  })
  @ApiProduces("text/csv")
  @ApiResponse({
    status: 200,
    description: "Archivo CSV con hasta 5000 filas.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query() query: OrdersQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.analyticsService.exportOrdersCsv(
      user.tenantId!,
      query,
    );
    const filename = `reporte-${query.dateFrom ?? "inicio"}-${query.dateTo ?? "hoy"}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }

  // ── Superadmin ────────────────────────────────────────────────────────

  // IMPORTANTE: global/summary debe ir ANTES de :tenantId/summary para que
  // NestJS no capture "global" como un tenantId param.
  @Get("global/summary")
  @Roles("superadmin")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: "Métricas globales cross-tenant (superadmin)",
    description:
      "Total de órdenes, revenue acumulado y tenant top en toda la plataforma.",
  })
  @ApiResponse({
    status: 200,
    schema: {
      example: {
        totalTenants: 0,
        activeTenants: 0,
        totalOrders: 2450,
        totalRevenue: 18530.25,
        topTenant: "la-hamburgueseria",
      },
    },
  })
  @ApiAuthErrors()
  getGlobalSummary() {
    return this.analyticsService.getGlobalSummary();
  }

  @Get("global/revenue-by-day")
  @Roles("superadmin")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: "Revenue global por día (superadmin)",
    description: "Para el gráfico de tendencia de la plataforma completa.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getGlobalRevenueByDay(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getGlobalRevenueByDay(query);
  }

  @Get("global/tenants-leaderboard")
  @Roles("superadmin")
  @Throttle({ relaxed: { ttl: 60_000, limit: 120 } })
  @ApiOperation({
    summary: "Ranking de tenants por revenue (superadmin)",
    description: "Top 20 tenants ordenados por revenue DESC en el período.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  getTenantsLeaderboard(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.getTenantsLeaderboard(query);
  }

  @Get(":tenantId/summary")
  @Roles("superadmin")
  @ApiOperation({
    summary: "Resumen de un tenant arbitrario (superadmin)",
    description:
      "Mismo shape que `GET /analytics/summary` pero con `tenantId` por path " +
      "(se ignora el tenantId del JWT).",
  })
  @ApiParam({ name: "tenantId", description: "ObjectId del tenant" })
  @ApiResponse({ status: 200, description: "Resumen del tenant." })
  @ApiValidationError()
  @ApiAuthErrors()
  getTenantSummary(
    @Param("tenantId") tenantId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.getTenantSummary(tenantId, query);
  }
}
