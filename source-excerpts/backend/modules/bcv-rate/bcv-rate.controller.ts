import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from "@nestjs/swagger";
import { BcvRateService } from "./bcv-rate.service";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { AuthUser, RatesSnapshot, UsdRate } from "@foodorder/types";
import {
  ApiAuthErrors,
  ApiValidationError,
} from "../../common/decorators/api-errors.decorator";
import { OverrideBcvRateDto } from "./dto/override-bcv-rate.dto";

/**
 * Endpoints de la tasa BCV.
 *
 * - GET  /bcv-rate              público — sirve directo desde cache o cae al fallback.
 * - POST /admin/bcv-rate/refresh   admin-only — fuerza una recarga del upstream
 *                                  saltándose el cache.
 */
@ApiTags("BCV Rate")
@Controller()
export class BcvRateController {
  constructor(private readonly bcvRateService: BcvRateService) {}

  @Get("bcv-rate")
  @ApiOperation({
    summary: "Tasa BCV vigente",
    description:
      "Devuelve la tasa oficial BCV (Bs por 1 USD). Endpoint público, sin auth. " +
      "Sirve desde Redis (TTL 1h). Si el upstream cae, usa el último valor conocido " +
      "con `stale: true` y, en último recurso, un valor hardcoded.",
  })
  @ApiResponse({ status: 200, description: "Tasa actual." })
  getCurrent(): Promise<UsdRate> {
    return this.bcvRateService.getCurrent();
  }

  @Post("admin/bcv-rate/refresh")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "superadmin")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Forzar refresh de la tasa BCV",
    description:
      "Salta el cache, golpea el upstream y guarda el resultado. Si el upstream " +
      "falla, devuelve 502 (a diferencia de GET que nunca tira).",
  })
  @ApiResponse({ status: 200, description: "Tasa refrescada." })
  @ApiResponse({ status: 502, description: "El upstream BCV no respondió." })
  @ApiAuthErrors()
  refresh(): Promise<UsdRate> {
    return this.bcvRateService.refresh();
  }

  @Post("admin/bcv-rate/override")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "superadmin")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Setear manualmente la tasa BCV",
    description:
      "Fija una tasa manual con TTL configurable (1h a 168h = 1 semana). " +
      "Mientras esté activa, el GET /bcv-rate devuelve este valor sin tocar " +
      "el upstream. Cuando expira el TTL, la próxima request reintenta el " +
      "upstream automáticamente. " +
      "Útil cuando el upstream del BCV está caído mucho tiempo y la tasa " +
      "hardcoded (36) no es razonable. Queda auditado en logs con " +
      "`[BCV-OVERRIDE]` (email del admin + razón opcional).",
  })
  @ApiResponse({
    status: 200,
    description: "Tasa manual seteada.",
    schema: {
      example: {
        value: 36.42,
        capturedAt: "2026-05-21T08:30:00.000Z",
        stale: false,
        source: "manual",
        manual_override: true,
        set_by: "admin@negocio.com",
      },
    },
  })
  @ApiAuthErrors()
  @ApiValidationError()
  override(
    @Body() dto: OverrideBcvRateDto,
    @CurrentUser() user: AuthUser,
  ): Promise<UsdRate> {
    return this.bcvRateService.setManualOverride({
      rate: dto.rate,
      ttlHours: dto.ttl_hours,
      reason: dto.reason,
      setBy: user.email,
    });
  }

  // ─── Multi-divisa ───────────────────────────────────────────────────────

  @Get("rates")
  @ApiOperation({
    summary: "Tasas multi-divisa (USD BCV, USD paralelo, EUR BCV, USDT)",
    description:
      "Snapshot de tasas del mercado venezolano. Endpoint público, sin auth. " +
      "Cada tasa se sirve desde su propio cache Redis con fallback last-known. " +
      "Nunca tira: si todo falla, devuelve valores hardcoded con `stale: true`.",
  })
  @ApiResponse({ status: 200, description: "Snapshot de tasas." })
  getRates(): Promise<RatesSnapshot> {
    return this.bcvRateService.getAllRates();
  }

  @Post("admin/rates/refresh")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin", "superadmin")
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Forzar refresh de todas las tasas",
    description:
      "Salta el cache y golpea el upstream de cada moneda en paralelo. " +
      "A diferencia de POST /admin/bcv-rate/refresh, este no tira si alguna " +
      "fuente falla — devuelve la snapshot con los stale flags correctos.",
  })
  @ApiResponse({ status: 200, description: "Snapshot refrescada." })
  @ApiAuthErrors()
  refreshAll(): Promise<RatesSnapshot> {
    return this.bcvRateService.refreshAllRates();
  }
}
