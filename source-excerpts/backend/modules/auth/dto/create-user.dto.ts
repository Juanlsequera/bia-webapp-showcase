import {
  IsEmail,
  IsEnum,
  IsMongoId,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { UserRole } from "@foodorder/types";

/**
 * DTO para `POST /auth/users`.
 * Las reglas de permisos se validan en AuthService.createUserByCaller:
 *   - superadmin → puede crear cualquier rol; tenantId requerido salvo superadmin
 *   - admin → solo puede crear admin/kitchen dentro de SU propio tenant (tenantId del body se ignora)
 *   - kitchen → 403
 */
export class CreateUserDto {
  @ApiProperty({
    description: "Email del nuevo usuario. Debe ser único.",
    example: "admin@pizzamia.com",
    format: "email",
  })
  @IsEmail({}, { message: "Email invalido" })
  email: string;

  @ApiProperty({
    description: "Password del nuevo usuario. Mínimo 8 caracteres.",
    example: "CambiameYa123",
    minLength: 8,
  })
  @IsString()
  @MinLength(8, { message: "Password minimo 8 caracteres" })
  password: string;

  @ApiProperty({
    description:
      "Rol del nuevo usuario. " +
      "`superadmin` solo lo puede crear otro superadmin. " +
      "`admin` y `kitchen` pueden crearse dentro de un tenant (si el caller es admin, " +
      "el tenantId se infiere de su JWT y lo del body se ignora).",
    enum: ["superadmin", "admin", "kitchen"],
    example: "admin",
  })
  @IsEnum(["superadmin", "admin", "kitchen"], { message: "Rol invalido" })
  role: UserRole;

  @ApiProperty({
    description:
      "ID del tenant al que pertenece el usuario. " +
      "Requerido cuando el superadmin crea un admin/kitchen. " +
      "Ignorado cuando un admin crea usuarios (usa su propio tenantId). " +
      "Omitir cuando se crea un superadmin.",
    example: "6620f14c1a9e3a2b4c8d1234",
    required: false,
  })
  @IsOptional()
  @IsMongoId({ message: "tenantId debe ser un ObjectId valido" })
  tenantId?: string;
}
