import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Res,
  ForbiddenException,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiProduces,
} from "@nestjs/swagger";
import type { Response } from "express";
import { PaymentTransactionService } from "./payment-transaction.service";
import { PaymentTransactionsQueryDto } from "./dto/payment-query.dto";
import { SaveArqueoDto } from "./dto/arqueo.dto";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import {
  AuthUser,
  PaymentClosingSummary,
  PaymentTransactionsResponse,
  CajaArqueo,
} from "@foodorder/types";
import {
  ApiAuthErrors,
  ApiValidationError,
} from "../../common/decorators/api-errors.decorator";

/**
 * `/admin/payments/*` — endpoints del dashboard "cerrar caja".
 *
 * Tres rutas:
 *   - `GET /admin/payments/transactions` — listado paginado + summary del rango.
 *   - `GET /admin/payments/closing-summary` — sólo el summary (widget).
 *   - `GET /admin/payments/export.csv` — descarga del rango filtrado.
 *
 * Todos requieren rol admin (no kitchen — cerrar caja es decisión del dueño).
 */
@ApiTags("Payments (admin)")
@Controller("admin/payments")
export class PaymentController {
  constructor(private readonly service: PaymentTransactionService) {}

  @Get("transactions")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Listado paginado de transacciones + summary del rango",
    description:
      'Endpoint principal de "cerrar caja". Si no se envía rango, usa HOY ' +
      "como default (caso típico). El `summary` agrega TODO el rango — no " +
      "solo la página visible — para que el footer del dashboard muestre " +
      "totales correctos.",
  })
  @ApiResponse({
    status: 200,
    description: "Data paginada + summary agregado.",
  })
  @ApiValidationError()
  @ApiAuthErrors()
  list(
    @CurrentUser() user: AuthUser,
    @Query() query: PaymentTransactionsQueryDto,
  ): Promise<PaymentTransactionsResponse> {
    this.assertTenant(user);
    return this.service.listForClosing(user.tenantId!, query);
  }

  @Get("closing-summary")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Resumen agregado del cierre",
    description:
      'Devuelve sólo los totales (sin data). Útil para un widget "estado ' +
      'de caja" en el dashboard sin pagar el costo del listado completo.',
  })
  @ApiResponse({ status: 200, description: "Resumen agregado del rango." })
  @ApiValidationError()
  @ApiAuthErrors()
  summary(
    @CurrentUser() user: AuthUser,
    @Query() query: PaymentTransactionsQueryDto,
  ): Promise<PaymentClosingSummary> {
    this.assertTenant(user);
    return this.service.getClosingSummary(user.tenantId!, query);
  }

  @Get("export.csv")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Exportar cierre como CSV (BOM UTF-8)",
    description:
      "Descarga hasta 5000 filas del rango filtrado. CSV con BOM para que " +
      "Excel lo abra correctamente. Incluye `traceId` por fila para " +
      "reconciliar contra los logs.",
  })
  @ApiProduces("text/csv")
  @ApiResponse({ status: 200, description: "Archivo CSV." })
  @ApiValidationError()
  @ApiAuthErrors()
  async exportCsv(
    @CurrentUser() user: AuthUser,
    @Query() query: PaymentTransactionsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    this.assertTenant(user);
    const csv = await this.service.exportClosingCsv(user.tenantId!, query);
    const filename = `cierre-caja-${query.dateFrom ?? "hoy"}-${query.dateTo ?? "hoy"}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Post("arqueo")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Guardar/actualizar el arqueo físico del día" })
  @ApiResponse({ status: 200 })
  @ApiAuthErrors()
  saveArqueo(
    @CurrentUser() user: AuthUser,
    @Body() dto: SaveArqueoDto,
  ): Promise<CajaArqueo> {
    this.assertTenant(user);
    return this.service.saveArqueo(user.tenantId!, dto, user.email);
  }

  @Get("arqueo/:date")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({ summary: "Obtener arqueo físico de una fecha (YYYY-MM-DD)" })
  @ApiResponse({ status: 200 })
  @ApiAuthErrors()
  getArqueo(
    @CurrentUser() user: AuthUser,
    @Param("date") date: string,
  ): Promise<CajaArqueo | null> {
    this.assertTenant(user);
    return this.service.getArqueo(user.tenantId!, date);
  }

  @Post("arqueo/close")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Cierre formal de caja del día",
    description:
      "Marca el arqueo de la fecha como cerrado formalmente (`is_closed=true`). " +
      "Idempotente: si ya estaba cerrado, devuelve el doc sin modificar.",
  })
  @ApiResponse({ status: 200 })
  @ApiAuthErrors()
  closeArqueo(
    @CurrentUser() user: AuthUser,
    @Body("date") date: string,
  ): Promise<CajaArqueo> {
    this.assertTenant(user);
    return this.service.closeArqueo(user.tenantId!, date, user.email);
  }

  private assertTenant(user: AuthUser): void {
    if (!user.tenantId) {
      throw new ForbiddenException("Usuario admin sin tenant asociado");
    }
  }
}
