import {
  IsInt,
  IsEnum,
  IsArray,
  ValidateNested,
  IsMongoId,
  IsOptional,
  IsString,
  Min,
  Max,
  IsNumber,
  IsPositive,
  IsEmail,
  MaxLength,
  Matches,
  MinLength,
  ValidateIf,
  IsNotEmpty,
  IsBoolean,
} from "class-validator";
import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ORDER_ARCHETYPES, type OrderArchetype } from "@foodorder/types";

export class CreateOrderItemDto {
  @ApiProperty({
    description:
      "ObjectId del producto — tiene que existir y estar `active` en este tenant.",
    example: "6620f14c1a9e3a2b4c8d1234",
  })
  @IsMongoId()
  productId: string;

  @ApiProperty({
    description: "Cantidad solicitada del producto.",
    example: 2,
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({
    description: 'Notas libres del cliente para este ítem (ej: "sin cebolla").',
    example: "sin tomate",
    maxLength: 200,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  notes?: string;

  @ApiPropertyOptional({
    description:
      "Retail: ObjectId de la variante seleccionada (talla, color, etc.). Opcional.",
    example: "6620f14c1a9e3a2b4c8d5678",
  })
  @IsOptional()
  @IsMongoId()
  variantId?: string | null;
}

export class CreateOrderDto {
  @ApiProperty({
    description:
      "Tipo de pedido: en mesa (dine_in), para llevar (takeaway) o delivery.",
    enum: ["dine_in", "takeaway", "delivery"],
    example: "dine_in",
  })
  @IsEnum(["dine_in", "takeaway", "delivery"])
  orderType: string;

  @ApiPropertyOptional({
    description: "Número de mesa (requerido cuando orderType = dine_in).",
    example: 5,
    minimum: 1,
    maximum: 500,
  })
  @ValidateIf((o) => o.orderType === "dine_in")
  @IsInt()
  @Min(1)
  @Max(500)
  tableNumber?: number;

  @ApiPropertyOptional({
    description:
      "Nombre del cliente (requerido cuando orderType = takeaway o delivery).",
    example: "Juan García",
    minLength: 2,
    maxLength: 60,
  })
  @ValidateIf((o) => o.orderType !== "dine_in")
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  customer_name?: string;

  @ApiProperty({
    description: "Ítems de la comanda. No puede ir vacío.",
    type: [CreateOrderItemDto],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];

  @ApiProperty({
    description:
      "Método de pago elegido por el cliente. " +
      "`cash`/`debit_card` dejan la orden en `pending_cash` hasta que el cajero confirme. " +
      "`pagomovil` deja la orden en `confirmed` esperando que el cliente cargue los datos. " +
      "`stripe`/`mercadopago` se aprueban por webhook.",
    enum: ["cash", "debit_card", "stripe", "mercadopago", "pagomovil"],
    example: "pagomovil",
  })
  @IsEnum(["cash", "debit_card", "stripe", "mercadopago", "pagomovil"])
  paymentMethod: string;

  @ApiPropertyOptional({
    description:
      "Teléfono opcional del cliente para notificarle por WhatsApp o push cuando el pedido esté listo. " +
      "Validación permisiva (formato venezolano típico).",
    example: "0414-1234567",
    maxLength: 20,
    pattern: "^\\+?[0-9\\s()-]{7,20}$",
  })
  @IsOptional()
  @IsEmail({}, { message: "customer_email debe ser un email válido" })
  customer_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  @Matches(/^\+?[0-9\s()-]{7,20}$/, {
    message: "customer_phone tiene formato inválido",
  })
  customer_phone?: string;

  @ApiPropertyOptional({
    enum: ORDER_ARCHETYPES,
    description:
      'Arquetipo de negocio. Si no se envía, se deriva de tenant.business_types[0]. Default: "food".',
  })
  @IsOptional()
  @IsEnum(ORDER_ARCHETYPES)
  archetype?: OrderArchetype;

  @ApiPropertyOptional({
    description:
      'Booking: ID del profesional asignado. Requerido cuando archetype = "booking"; rechazado para otros arquetipos.',
    example: "6620f14c1a9e3a2b4c8d1234",
  })
  // Requerido si el cliente envía explícitamente archetype=booking
  @ValidateIf((o) => o.archetype === "booking")
  @IsNotEmpty({ message: "staffId es obligatorio para bookings" })
  @IsMongoId({ message: "staffId debe ser un ObjectId válido" })
  // Ignorado (opcional) para cualquier otro arquetipo
  @ValidateIf((o) => o.archetype !== "booking")
  @IsOptional()
  staffId?: string | null;

  @ApiPropertyOptional({
    description:
      'Booking: Datetime de la cita (ISO 8601). Requerido cuando archetype = "booking". Ej: "2026-05-20T10:30:00Z".',
    example: "2026-05-20T10:30:00Z",
  })
  // Requerido si el cliente envía explícitamente archetype=booking
  @ValidateIf((o) => o.archetype === "booking")
  @IsNotEmpty({ message: "bookingDatetime es obligatorio para bookings" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, {
    message: "bookingDatetime debe ser ISO 8601",
  })
  // Ignorado (opcional) para cualquier otro arquetipo
  @ValidateIf((o) => o.archetype !== "booking")
  @IsOptional()
  bookingDatetime?: string | null;
}

// El cliente envía estos datos después de hacer la transferencia PagoMóvil
export class SubmitPagomovilDto {
  @ApiProperty({
    description:
      "Número de referencia que devolvió el banco al confirmar la transferencia.",
    example: "123456789012",
    maxLength: 60,
  })
  @IsString()
  @MaxLength(60)
  pagomovil_reference: string;

  @ApiProperty({
    description:
      "Teléfono desde el que se hizo la transferencia. Debe ser un móvil venezolano válido (0412/0414/0416/0424/0426 + 7 dígitos). Acepta separadores opcionales (guion o espacio).",
    example: "04141234567",
    maxLength: 20,
  })
  // BUG-07: validar formato VE en backend (el front no es la única vía de entrada).
  // Acepta 04141234567, 0414-1234567, 0414 1234567.
  @IsString()
  @MaxLength(20)
  @Matches(/^(0412|0414|0416|0424|0426)[-\s]?\d{7}$/, {
    message:
      "pagomovil_phone debe ser un móvil venezolano válido (04XX-XXXXXXX)",
  })
  pagomovil_phone: string;

  @ApiProperty({
    description: "Banco emisor de la transferencia.",
    example: "Banesco",
    maxLength: 60,
  })
  @IsString()
  @MaxLength(60)
  pagomovil_bank: string;

  @ApiPropertyOptional({
    description:
      "Cédula del pagador. Opcional — en Venezuela el comprobante compartido no muestra la " +
      "cédula del emisor (solo la del beneficiario), así que el cliente no puede extraerla del " +
      "OCR. El admin puede verificarla contra la notificación que recibe de su propio banco.",
    example: "V-12345678",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  pagomovil_cedula?: string;

  @ApiProperty({
    description: "Monto transferido (debe coincidir con el total de la orden).",
    example: 17,
    minimum: 0.01,
  })
  @IsNumber()
  @IsPositive()
  pagomovil_amount: number;

  // ── Campos opcionales enriquecidos por el OCR del comprobante ──
  // Los guardamos en `payment_transactions` para auditoría / soporte —
  // así si un cliente jura que transfirió al lugar correcto, podemos verificar.

  @ApiPropertyOptional({
    description:
      "Teléfono del BENEFICIARIO extraído por OCR del comprobante. " +
      "Sirve para cross-check contra el pagomóvil configurado del tenant.",
    example: "04245267220",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  pagomovil_beneficiary_phone?: string;

  @ApiPropertyOptional({
    description: "Banco del BENEFICIARIO extraído por OCR del comprobante.",
    example: "Banco de Venezuela",
  })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  pagomovil_beneficiary_bank?: string;

  @ApiPropertyOptional({
    description:
      "Resultado del cross-check del teléfono beneficiario (del recibo) " +
      "vs el pagomóvil configurado del tenant. `match` si coincidieron, " +
      "`mismatch` si el cliente transfirió a otro número, `unknown` si no " +
      "se pudo comparar (OCR no extrajo teléfono o tenant sin config).",
    enum: ["match", "mismatch", "unknown"],
    example: "match",
  })
  @IsOptional()
  @IsEnum(["match", "mismatch", "unknown"])
  pagomovil_crosscheck?: "match" | "mismatch" | "unknown";

  @ApiPropertyOptional({
    description:
      "Fecha del comprobante extraída por OCR (dd/mm/yyyy). Solo para auditoría — el cliente no la ve.",
    example: "13/05/2026",
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  pagomovil_date?: string;
}

// El admin aprueba o rechaza la verificación
export class VerifyPagomovilDto {
  @ApiProperty({
    description: "Decisión del admin tras revisar los datos y el comprobante.",
    enum: ["approved", "rejected"],
    example: "approved",
  })
  @IsEnum(["approved", "rejected"])
  decision: "approved" | "rejected";

  @ApiPropertyOptional({
    description:
      "Motivo del rechazo (visible para el cliente). Obligatorio UX-wise si `decision = rejected`.",
    example: "Referencia no coincide con el banco.",
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  rejection_reason?: string;

  @ApiPropertyOptional({
    description:
      "Si el monto declarado por el cliente discrepa > 2% del esperado, " +
      "la aprobación es bloqueada por defecto. Setear `true` solo si el admin " +
      "verificó manualmente en el banco que el monto recibido es correcto. " +
      "Queda auditado en logs.",
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  force_approve?: boolean;
}

// El panel de cocina cambia el estado de la comanda.
// El enum incluye estados de todos los arquetipos; la state machine valida
// que la transición sea válida para el arquetipo concreto de la orden.
const ALL_ORDER_STATUSES = [
  // Food / Retail
  "preparing",
  "ready",
  "delivered",
  // Booking
  "in_progress",
  "completed",
  "no_show",
  "rescheduled",
  "scheduled",
  // Services
  "approved",
  "rejected",
  // All archetypes
  "cancelled",
] as const;

export class UpdateOrderStatusDto {
  @ApiProperty({
    description:
      "Nuevo estado de la comanda. La transición se valida server-side " +
      "por la state machine del arquetipo correspondiente.",
    enum: ALL_ORDER_STATUSES,
    example: "preparing",
  })
  @IsEnum(ALL_ORDER_STATUSES)
  status: string;

  @ApiPropertyOptional({
    description:
      "Motivo de cancelación. Solo se persiste si status = cancelled.",
    example: "El cliente se arrepintió.",
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cancellation_reason?: string;
}

// El cajero confirma el cobro en efectivo
export class ConfirmCashPaymentDto {
  @ApiPropertyOptional({
    description:
      "Notas del cajero al momento de confirmar el cobro (quedan en el log de pago).",
    example: "Cobrado con billete de 20$.",
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

// El admin envía una cotización para una orden de tipo service (archetype=service)
export class SubmitQuoteDto {
  @ApiProperty({
    description:
      "Monto cotizado en USD. El cliente lo verá en la página de estado de su solicitud.",
    example: 75.0,
    minimum: 0.01,
  })
  @IsNumber()
  @IsPositive()
  quote_amount: number;

  @ApiPropertyOptional({
    description:
      "Notas del admin para el cliente: descripción del trabajo, desglose, condiciones.",
    example:
      "Incluye mano de obra y materiales básicos. Tiempo estimado: 2 horas.",
    maxLength: 1000,
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  quote_notes?: string;
}
