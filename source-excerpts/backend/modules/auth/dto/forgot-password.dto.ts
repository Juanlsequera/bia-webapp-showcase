import { ApiProperty } from "@nestjs/swagger";
import { IsEmail } from "class-validator";

export class ForgotPasswordDto {
  @ApiProperty({ example: "admin@demo-burger.com" })
  @IsEmail({}, { message: "email debe ser un email válido" })
  email: string;
}
