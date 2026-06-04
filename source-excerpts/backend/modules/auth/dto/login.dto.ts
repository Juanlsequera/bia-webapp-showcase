import { IsEmail, IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class LoginDto {
  @ApiProperty({
    description: "Email del usuario (admin, kitchen o superadmin).",
    example: "admin@lahamburgueseria.com",
    format: "email",
  })
  @IsEmail({}, { message: "Email invalido" })
  email: string;

  @ApiProperty({
    description: "Contraseña del usuario. Mínimo 6 caracteres.",
    example: "supersecret",
    minLength: 6,
  })
  @IsString()
  @MinLength(6, { message: "Password minimo 6 caracteres" })
  password: string;
}
