import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsMongoId,
  Matches,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Query params comunes a los endpoints de analytics.
 * Todos son opcionales; si no se envían, el servicio usa defaults razonables
 * (ej: último día / últimos 30 días).
 *
 * `dateFrom` y `dateTo` son fechas en formato ISO `YYYY-MM-DD`. La inclusividad
 * es: [dateFrom 00:00:00, dateTo 23:59:59.999] en la TZ del servidor.
 */
export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    description:
      "Fecha de inicio del rango (inclusiva, 00:00 UTC). Default: hoy - 30 días.",
    example: "2026-04-01",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "dateFrom debe ser YYYY-MM-DD" })
  dateFrom?: string;

  @ApiPropertyOptional({
    description:
      "Fecha de fin del rango (inclusiva, 23:59:59.999 UTC). Default: hoy.",
    example: "2026-04-20",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "dateTo debe ser YYYY-MM-DD" })
  dateTo?: string;
}

/**
 * Query params para el listado paginado `/analytics/orders`.
 * Incluye todos los filtros útiles para el panel de admin.
 */
export class OrdersQueryDto extends AnalyticsQueryDto {
  @ApiPropertyOptional({
    description: "Filtra por estado de la comanda.",
    example: "delivered",
  })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({
    description: "Filtra por método de pago.",
    example: "pagomovil",
    enum: ["cash", "stripe", "mercadopago", "pagomovil"],
  })
  @IsOptional()
  @IsString()
  paymentMethod?: string;

  @ApiPropertyOptional({
    description: "Sólo órdenes que incluyen este producto (ObjectId).",
    example: "6620f14c1a9e3a2b4c8d1234",
  })
  @IsOptional()
  @IsMongoId()
  productId?: string;

  @ApiPropertyOptional({
    description: "Sólo órdenes de esta mesa.",
    example: 5,
    minimum: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tableNumber?: number;

  @ApiPropertyOptional({
    description: "Filtra por tipo de pedido.",
    enum: ["dine_in", "takeaway", "delivery"],
    example: "takeaway",
  })
  @IsOptional()
  @IsString()
  orderType?: string;

  @ApiPropertyOptional({
    description: "Página (arranca en 1).",
    example: 1,
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Ítems por página. Máximo 200.",
    example: 50,
    minimum: 1,
    maximum: 200,
    default: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number = 50;
}
