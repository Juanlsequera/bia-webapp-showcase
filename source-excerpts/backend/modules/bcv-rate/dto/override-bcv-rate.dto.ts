import {
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

/**
 * DTO para POST /admin/bcv-rate/override.
 *
 * Cuando el upstream del BCV está caído por mucho tiempo, el admin puede
 * fijar manualmente una tasa para que las órdenes nuevas usen un valor
 * razonable hasta que el upstream vuelva (o que el admin actualice de nuevo).
 */
export class OverrideBcvRateDto {
  @ApiProperty({
    description: "Bolívares por 1 USD. Validado entre 1 y 10000.",
    example: 36.42,
    minimum: 1,
    maximum: 10000,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1, { message: "rate debe ser mayor o igual a 1" })
  @Max(10000, { message: "rate debe ser menor o igual a 10000" })
  rate: number;

  @ApiProperty({
    description:
      "Tiempo en horas que dura el override (luego vuelve al upstream). Entre 1 y 168 (1 semana).",
    example: 24,
    minimum: 1,
    maximum: 168,
  })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1, { message: "ttl_hours debe ser al menos 1" })
  @Max(168, { message: "ttl_hours no puede exceder 168 (1 semana)" })
  ttl_hours: number;

  @ApiProperty({
    description: "Motivo del override (queda en logs para auditoría).",
    example: "API del BCV caída desde ayer, fijo tasa promedio paralelo",
    required: false,
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200, { message: "reason no puede exceder 200 caracteres" })
  reason?: string;
}
