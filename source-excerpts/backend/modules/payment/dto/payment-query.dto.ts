import {
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  IsIn,
  Matches,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiPropertyOptional } from "@nestjs/swagger";

/**
 * Query params para `GET /admin/payments/transactions` y export CSV.
 *
 * `dateFrom`/`dateTo` son inclusivos en formato `YYYY-MM-DD`. Si no se
 * envían, el servicio defaultea al día de hoy (caso típico: "cerrar la
 * caja del día").
 */
export class PaymentTransactionsQueryDto {
  @ApiPropertyOptional({
    description: "Fecha de inicio (inclusiva, 00:00). Default: hoy.",
    example: "2026-04-25",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "dateFrom debe ser YYYY-MM-DD" })
  dateFrom?: string;

  @ApiPropertyOptional({
    description: "Fecha de fin (inclusiva, 23:59:59.999). Default: hoy.",
    example: "2026-04-25",
    pattern: "^\\d{4}-\\d{2}-\\d{2}$",
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "dateTo debe ser YYYY-MM-DD" })
  dateTo?: string;

  @ApiPropertyOptional({
    description: "Filtrar por estado del review.",
    enum: ["pending_review", "approved", "rejected"],
  })
  @IsOptional()
  @IsIn(["pending_review", "approved", "rejected"])
  status?: "pending_review" | "approved" | "rejected";

  @ApiPropertyOptional({
    description: "Filtrar por método de pago.",
    enum: ["pagomovil", "cash", "stripe", "mercadopago"],
  })
  @IsOptional()
  @IsIn(["pagomovil", "cash", "stripe", "mercadopago"])
  method?: "pagomovil" | "cash" | "stripe" | "mercadopago";

  @ApiPropertyOptional({
    description: "Página (1-based).",
    minimum: 1,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    description: "Ítems por página.",
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
