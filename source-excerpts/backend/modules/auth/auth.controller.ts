import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import {
  AuthUser,
  ForgotPasswordResponse,
  LoginResponse,
  RefreshTokenResponse,
  LogoutResponse,
} from "@foodorder/types";
import { AuthService } from "./auth.service";
import { LoginDto } from "./dto/login.dto";
import { CreateUserDto } from "./dto/create-user.dto";
import { ForgotPasswordDto } from "./dto/forgot-password.dto";
import { ResetPasswordDto } from "./dto/reset-password.dto";
import { ChangePasswordDto } from "./dto/change-password.dto";
import { RefreshTokenDto } from "./dto/refresh-token.dto";
import { CurrentUser } from "./decorators/current-user.decorator";
import { Roles } from "./decorators/roles.decorator";
import { JwtAuthGuard } from "./guards/jwt.guard";
import { RolesGuard } from "./guards/roles.guard";
import {
  ApiValidationError,
  ApiAuthErrors,
  ApiConflict,
} from "../../common/decorators/api-errors.decorator";

@ApiTags("Auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  // ── LOGIN ───────────────────────────────────────────────────────────────
  // Rate limit estricto (5 intentos / 15min por IP) anti-bruteforce.
  // Fuera de producción el límite sube a 1000 para que los specs E2E no se
  // bloqueen mutuamente (todos corren desde 127.0.0.1 y suman > 5 logins).
  @Post("login")
  @Throttle({
    default: {
      ttl: 15 * 60_000,
      limit: process.env.NODE_ENV !== "production" ? 1000 : 5,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Login con email + password",
    description:
      "Devuelve un JWT que incluye `role` y (para admin/kitchen) el `tenantId`. " +
      "El cliente debe guardarlo y mandarlo en `Authorization: Bearer <token>` " +
      "en todos los endpoints protegidos.",
  })
  @ApiResponse({
    status: 200,
    description:
      "Credenciales válidas. Devuelve el JWT y los datos básicos del usuario.",
    schema: {
      example: {
        access_token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
        user: {
          email: "admin@lahamburgueseria.com",
          role: "admin",
          tenantId: "6620f14c1a9e3a2b4c8d1234",
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Email no existe o contraseña incorrecta.",
  })
  @ApiValidationError()
  login(@Body() dto: LoginDto): Promise<LoginResponse> {
    return this.authService.login(dto);
  }

  // ── REFRESH TOKEN ───────────────────────────────────────────────────────
  // Rota el par usando el refresh_token. Si el refresh es válido, emite un par
  // nuevo (access + refresh) e invalida el anterior. Si se detecta reuso (un
  // refresh que ya fue rotado en su familia) se cierra toda la sesión.
  // Throttle laxo: el frontend lo puede llamar varias veces al cargar la app
  // (en paralelo con queries iniciales). 30 req/min por IP es generoso.
  @Post("refresh")
  @Throttle({
    default: {
      ttl: 60_000,
      limit: process.env.NODE_ENV === "test" ? 1000 : 30,
    },
  })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Rotar el par access/refresh",
    description:
      "Recibe el refresh_token actual y devuelve un par nuevo. El refresh viejo " +
      "queda invalidado y el access anterior se blacklistea hasta su exp natural. " +
      "Si se detecta reuso (refresh ya rotado), toda la familia se revoca.",
  })
  @ApiResponse({
    status: 200,
    description: "Par rotado.",
    schema: {
      example: {
        access_token: "eyJhbGciOi...",
        refresh_token: "YmFzZTY0dXJsdG9rZW4",
        expires_in: 36000,
        refresh_expires_in: 2592000,
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: "Refresh inválido, expirado o reuso detectado.",
  })
  @ApiResponse({
    status: 503,
    description: "Auth no disponible (Redis no configurado).",
  })
  @ApiValidationError()
  refresh(@Body() dto: RefreshTokenDto): Promise<RefreshTokenResponse> {
    return this.authService.refresh(dto.refresh_token);
  }

  // ── LOGOUT ──────────────────────────────────────────────────────────────
  // Requiere JWT actual + refresh_token del body. Cierra la sesión (familia)
  // y blacklistea el access actual. Idempotente — si el refresh ya no existe
  // o es inválido, igual responde success.
  @Post("logout")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Cerrar sesión",
    description:
      "Revoca la familia de refresh tokens identificada por el refresh_token " +
      "enviado y blacklistea el access actual hasta su exp natural. " +
      "Idempotente.",
  })
  @ApiResponse({
    status: 200,
    description: "Sesión cerrada.",
    schema: { example: { success: true } },
  })
  @ApiAuthErrors()
  @ApiValidationError()
  logout(
    @CurrentUser() user: AuthUser,
    @Body() dto: RefreshTokenDto,
  ): Promise<LogoutResponse> {
    return this.authService.logout(dto.refresh_token, user.email);
  }

  // ── BOOTSTRAP SUPERADMIN ────────────────────────────────────────────────
  // Endpoint idempotente de "primera vez". No pide JWT porque en un ambiente
  // nuevo todavía no existe ningún user. En cuanto ya hay un superadmin,
  // devuelve 409 y se usa POST /auth/users (protegido) para crear más.
  @Post("bootstrap")
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: "Crear el primer superadmin (bootstrap)",
    description:
      "Se ejecuta UNA sola vez al arrancar un ambiente nuevo. " +
      "Lee `SUPERADMIN_EMAIL` y `SUPERADMIN_PASSWORD` del `.env`, hashea la password y crea el usuario. " +
      "No pide JWT porque en ese momento aún no existe ningún usuario. " +
      "Si ya hay al menos un superadmin en la base devuelve 409 — de ahí en adelante hay que " +
      "usar `POST /auth/users` con JWT de superadmin.",
  })
  @ApiResponse({
    status: 201,
    description: "Superadmin creado.",
    schema: { example: { email: "admin@example.com", role: "superadmin" } },
  })
  @ApiResponse({
    status: 409,
    description:
      "Ya existe un superadmin. Este endpoint solo sirve para el bootstrap inicial.",
  })
  @ApiResponse({
    status: 500,
    description:
      "Faltan SUPERADMIN_EMAIL / SUPERADMIN_PASSWORD en el .env o son inválidos.",
  })
  bootstrap(): Promise<{ email: string; role: string }> {
    return this.authService.bootstrapSuperadmin();
  }

  // ── LISTAR USUARIOS ────────────────────────────────────────────────────
  // superadmin → todos los usuarios (filtrable por role/tenantId).
  // admin      → solo los usuarios de su tenant.
  @Get("users")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("superadmin", "admin")
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Listar usuarios",
    description:
      "superadmin: devuelve todos los usuarios del sistema (filtrable por `role` y `tenantId`). " +
      "admin: devuelve solo los usuarios de su propio tenant.",
  })
  @ApiResponse({ status: 200, description: "Lista de usuarios." })
  @ApiAuthErrors()
  listUsers(
    @CurrentUser() caller: AuthUser,
    @Query("role") role?: string,
    @Query("tenantId") tenantId?: string,
  ) {
    return this.authService.listUsers(caller, { role, tenantId });
  }

  // ── CREAR USUARIOS (admin o superadmin) ────────────────────────────────
  @Post("users")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("superadmin", "admin")
  @Throttle({ default: { ttl: 60_000, limit: 10 } }) // máx 10 usuarios/min por IP
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Crear un usuario (admin/kitchen/superadmin)",
    description:
      "Reglas de permisos:\n" +
      "- **superadmin**: puede crear cualquier rol. Para admin/kitchen es obligatorio `tenantId`. Para superadmin no debe incluirse.\n" +
      "- **admin**: solo puede crear `admin` o `kitchen` dentro de su propio tenant. El `tenantId` del body se ignora y se usa el del JWT.\n" +
      "- **kitchen**: 403, no puede crear usuarios.",
  })
  @ApiResponse({
    status: 201,
    description: "Usuario creado.",
    schema: {
      example: {
        _id: "6620f14c1a9e3a2b4c8d1234",
        email: "admin@pizzamia.com",
        role: "admin",
        tenantId: "6620f14c1a9e3a2b4c8d1111",
      },
    },
  })
  @ApiConflict("Ya existe un usuario con ese email.")
  @ApiAuthErrors()
  @ApiValidationError()
  createUser(
    @CurrentUser() caller: AuthUser,
    @Body() dto: CreateUserDto,
  ): Promise<{ _id: string; email: string; role: string; tenantId?: string }> {
    return this.authService.createUserByCaller(caller, dto);
  }

  // ── FORGOT PASSWORD ─────────────────────────────────────────────────────
  // Rate limit estricto: anti-spam de Resend (free tier 3000 emails/mes)
  // y anti-enumeración por timing. 5 requests / 15 min por IP es generoso
  // para usuarios legítimos pero corta cualquier intento de flood.
  @Post("forgot-password")
  @Throttle({ default: { ttl: 15 * 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Solicitar código para resetear contraseña",
    description:
      "Genera un código de 6 dígitos y lo envía al email registrado del " +
      "usuario. TTL 15 minutos. **El código sólo viaja por email** — nunca " +
      "se devuelve en la respuesta de la API. **Siempre devuelve 200**, " +
      "incluso si el email no existe (anti-enumeration). En dev sin " +
      "`RESEND_API_KEY` el código se loguea en la consola del backend " +
      "para que el desarrollador local pueda probar — eso NO funciona en " +
      "prod (sin API key configurada el email nunca llega y el flow queda " +
      "silenciosamente roto).",
  })
  @ApiResponse({
    status: 200,
    description: "Si la cuenta existe, se envió el código.",
    schema: { example: { delivered: true } },
  })
  @ApiResponse({ status: 503, description: "Redis no configurado." })
  @ApiValidationError()
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponse> {
    return this.authService.forgotPassword(dto.email);
  }

  // ── RESET PASSWORD ──────────────────────────────────────────────────────
  // Mismo throttler que /login + /forgot-password. Aunque el service ya
  // limita a 5 intentos por código, esto frena el caso de "atacante
  // probando muchos emails+codes en paralelo".
  @Post("reset-password")
  @Throttle({ default: { ttl: 15 * 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Validar código y aplicar nueva contraseña",
    description:
      "Valida el código de 6 dígitos contra el guardado en Redis. " +
      "Después de 5 intentos fallidos, el código se invalida y hay que " +
      "pedir uno nuevo con `/auth/forgot-password`.",
  })
  @ApiResponse({
    status: 200,
    description: "Contraseña actualizada.",
    schema: { example: { success: true } },
  })
  @ApiResponse({
    status: 401,
    description: "Código inválido, expirado o demasiados intentos.",
  })
  @ApiResponse({ status: 503, description: "Redis no configurado." })
  @ApiValidationError()
  resetPassword(@Body() dto: ResetPasswordDto): Promise<{ success: true }> {
    return this.authService.resetPassword(dto.email, dto.code, dto.newPassword);
  }

  // ── CHANGE PASSWORD (logueado) ──────────────────────────────────────────
  @Post("change-password")
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Cambiar contraseña del usuario logueado",
    description:
      "Requiere JWT y la contraseña actual como confirmación. " +
      'Útil para "Editar perfil" del admin/kitchen — distinto del flow ' +
      "olvidé-mi-password (forgot/reset).",
  })
  @ApiResponse({
    status: 200,
    description: "Contraseña cambiada.",
    schema: { example: { success: true } },
  })
  @ApiResponse({
    status: 401,
    description: "JWT inválido o currentPassword incorrecta.",
  })
  @ApiResponse({
    status: 400,
    description: "newPassword igual a currentPassword.",
  })
  @ApiAuthErrors()
  @ApiValidationError()
  changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<{ success: true }> {
    return this.authService.changePassword(
      user._id,
      dto.currentPassword,
      dto.newPassword,
    );
  }
}
