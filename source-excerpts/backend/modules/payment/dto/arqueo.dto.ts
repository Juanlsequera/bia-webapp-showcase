import { IsString, IsNumber, IsOptional, Matches, Min } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";

export class SaveArqueoDto {
  @ApiProperty({ description: "Fecha YYYY-MM-DD", example: "2026-05-08" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @ApiPropertyOptional({
    description: "Efectivo físico contado (Bs)",
    example: 850,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  efectivo_fisico?: number;

  @ApiPropertyOptional({
    description: "Total débito del ticket POS (Bs)",
    example: 1200,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  debito_fisico?: number;

  @ApiPropertyOptional({ description: "URL comprobante POS en Cloudinary" })
  @IsOptional()
  @IsString()
  debito_receipt_url?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  debito_receipt_public_id?: string;

  @ApiPropertyOptional({ description: "Notas del cajero" })
  @IsOptional()
  @IsString()
  notas?: string;
}
