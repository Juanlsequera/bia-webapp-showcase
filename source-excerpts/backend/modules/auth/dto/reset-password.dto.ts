import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsString, Length, MinLength, Matches } from "class-validator";

export class ResetPasswordDto {
  @ApiProperty({ example: "admin@demo-burger.com" })
  @IsEmail({}, { message: "email debe ser un email válido" })
  email: string;

  @ApiProperty({
    description: "Código de 6 dígitos enviado por email.",
    example: "123456",
  })
  @IsString()
  @Length(6, 6, { message: "code debe tener exactamente 6 dígitos" })
  @Matches(/^\d{6}$/, { message: "code debe ser numérico de 6 dígitos" })
  code: string;

  @ApiProperty({
    description: "Nueva contraseña, mínimo 8 caracteres.",
    example: "NuevoPass123",
  })
  @IsString()
  @MinLength(8, { message: "newPassword debe tener al menos 8 caracteres" })
  newPassword: string;
}
