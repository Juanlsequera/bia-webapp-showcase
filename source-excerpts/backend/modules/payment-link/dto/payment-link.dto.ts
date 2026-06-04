import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  MaxLength,
  MinLength,
  IsDateString,
  IsEnum,
  IsUrl,
  Matches,
} from "class-validator";

export class CreatePaymentLinkDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  description: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amount: number;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  customerName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  internalNote?: string;

  /** ISO 8601 — si no se envía el link no expira */
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  /** Método de pago que verá el cliente. Default: pagomovil */
  @IsOptional()
  @IsEnum(["pagomovil", "transfer", "zelle"])
  paymentMethod?: "pagomovil" | "transfer" | "zelle";

  /** ObjectId de la cuenta del tenant a usar (bankAccount, transferAccount o zelleAccount) */
  @IsOptional()
  @IsString()
  @MaxLength(24)
  paymentAccountId?: string;
}

export class MarkPaidDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  paidWith: string;
}

/**
 * Datos que el cliente carga desde la página pública del link tras hacer
 * la transferencia PagoMóvil. Mismo shape que `SubmitPagomovilDto` del módulo
 * order, replicado acá porque el módulo payment-link no debería depender de
 * order. La validación es idéntica.
 */
export class SubmitPaymentLinkPagomovilDto {
  @IsString()
  @MinLength(8)
  @MaxLength(60)
  pagomovil_reference: string;

  @IsString()
  @MaxLength(20)
  @Matches(/^(0412|0414|0416|0424|0426)[-\s]?\d{7}$/, {
    message:
      "pagomovil_phone debe ser un móvil venezolano válido (04XX-XXXXXXX)",
  })
  pagomovil_phone: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  pagomovil_bank?: string;

  /** Monto en Bs (debe coincidir aproximadamente con amount_usd × tasaBCV). */
  @IsNumber()
  @IsPositive()
  pagomovil_amount_bs: number;

  /** URL Cloudinary devuelta por POST /upload-receipt. */
  @IsUrl()
  @MaxLength(500)
  pagomovil_receipt_url: string;

  // ── Campos enriquecidos por OCR (opcionales) ──

  @IsOptional()
  @IsString()
  @MaxLength(20)
  pagomovil_beneficiary_phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  pagomovil_beneficiary_bank?: string;

  @IsOptional()
  @IsEnum(["match", "mismatch", "unknown"])
  pagomovil_crosscheck?: "match" | "mismatch" | "unknown";

  @IsOptional()
  @IsString()
  @MaxLength(20)
  pagomovil_date?: string;
}

/** Datos que el cliente carga al pagar con transferencia bancaria. */
export class SubmitTransferDto {
  /** URL Cloudinary devuelta por POST /upload-receipt */
  @IsUrl()
  @MaxLength(500)
  receipt_url: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  transfer_reference?: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  transfer_amount?: number;

  @IsOptional()
  @IsEnum(["VES", "USD"])
  transfer_currency?: "VES" | "USD";

  @IsOptional()
  @IsString()
  @MaxLength(100)
  transfer_sender_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  transfer_date?: string;

  @IsOptional()
  @IsEnum(["match", "mismatch", "unknown"])
  transfer_crosscheck?: "match" | "mismatch" | "unknown";
}

/** Datos que el cliente carga al pagar con Zelle. */
export class SubmitZelleDto {
  /** URL Cloudinary devuelta por POST /upload-receipt */
  @IsUrl()
  @MaxLength(500)
  receipt_url: string;

  @IsOptional()
  @IsNumber()
  @IsPositive()
  zelle_amount?: number;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  zelle_reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  zelle_sender_name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  zelle_sender_email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  zelle_date?: string;

  @IsOptional()
  @IsEnum(["match", "mismatch", "unknown"])
  zelle_crosscheck?: "match" | "mismatch" | "unknown";
}
