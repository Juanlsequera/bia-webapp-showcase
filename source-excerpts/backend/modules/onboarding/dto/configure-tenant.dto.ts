import {
  IsArray,
  IsEnum,
  IsIn,
  IsObject,
  IsString,
  ValidateNested,
  IsOptional,
  IsBoolean,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty } from "@nestjs/swagger";
import type { BusinessType, TenantPlan, TenantModules } from "@foodorder/types";

const PLANS: TenantPlan[] = ["starter", "pro", "enterprise"];
const ARCHETYPES: BusinessType[] = ["food", "retail", "booking", "service"];

class TenantModulesDto {
  @ApiProperty({ description: "Pantalla de cocina (KDS)", example: true })
  @IsOptional()
  @IsBoolean()
  kitchen_kds?: boolean;

  @ApiProperty({ description: "Agenda / Citas", example: false })
  @IsOptional()
  @IsBoolean()
  booking?: boolean;

  @ApiProperty({ description: "Variantes de producto", example: true })
  @IsOptional()
  @IsBoolean()
  product_variants?: boolean;

  @ApiProperty({ description: "Modificadores de ítem", example: true })
  @IsOptional()
  @IsBoolean()
  product_modifiers?: boolean;

  @ApiProperty({ description: "Control de inventario", example: false })
  @IsOptional()
  @IsBoolean()
  inventory_tracking?: boolean;

  @ApiProperty({ description: "Zonas de delivery", example: true })
  @IsOptional()
  @IsBoolean()
  delivery_zones?: boolean;

  @ApiProperty({ description: "Pedidos programados", example: false })
  @IsOptional()
  @IsBoolean()
  scheduled_orders?: boolean;

  @ApiProperty({ description: "Mano de obra", example: false })
  @IsOptional()
  @IsBoolean()
  labor_pricing?: boolean;

  @ApiProperty({ description: "Cotizaciones", example: false })
  @IsOptional()
  @IsBoolean()
  quotes_estimates?: boolean;

  @ApiProperty({ description: "Gestión de staff", example: false })
  @IsOptional()
  @IsBoolean()
  staff_management?: boolean;

  @ApiProperty({ description: "Programa de lealtad", example: false })
  @IsOptional()
  @IsBoolean()
  loyalty_program?: boolean;

  @ApiProperty({ description: "Cupones y descuentos", example: false })
  @IsOptional()
  @IsBoolean()
  coupons_discounts?: boolean;

  @ApiProperty({
    description: "Documentos financieros con extracción LLM",
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  finance_documents?: boolean;
}

export class ConfigureTenantDto {
  @ApiProperty({
    description: "Plan del tenant",
    enum: PLANS,
    example: "pro",
  })
  @IsIn(PLANS)
  plan!: TenantPlan;

  @ApiProperty({
    description: "Tipos de negocio",
    example: ["food"],
    isArray: true,
  })
  @IsArray()
  @IsEnum(ARCHETYPES, { each: true })
  business_types!: BusinessType[];

  @ApiProperty({
    description: "ID del template elegido",
    example: "restaurant-qr",
  })
  @IsString()
  template_id!: string;

  @ApiProperty({
    description: "Módulos habilitados para el tenant",
    type: TenantModulesDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => TenantModulesDto)
  modules?: Partial<TenantModules>;
}
