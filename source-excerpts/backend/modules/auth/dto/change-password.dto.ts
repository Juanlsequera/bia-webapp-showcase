import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class ChangePasswordDto {
  @ApiProperty({ description: "Contraseña actual del usuario logueado." })
  @IsString()
  currentPassword: string;

  @ApiProperty({
    description: "Nueva contraseña, mínimo 8 caracteres.",
    example: "NuevoPass123",
  })
  @IsString()
  @MinLength(8, { message: "newPassword debe tener al menos 8 caracteres" })
  newPassword: string;
}
