import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import * as bcrypt from "bcrypt";
import * as crypto from "crypto";
import type Redis from "ioredis";
import {
  AuthUser,
  LoginDto,
  LoginResponse,
  UserRole,
  ForgotPasswordResponse,
  RefreshTokenResponse,
  LogoutResponse,
} from "@foodorder/types";
import { User, UserDocument } from "./schemas/user.schema";
import { Tenant, TenantDocument } from "../tenant/schemas/tenant.schema";
import { CreateUserDto } from "./dto/create-user.dto";
import { AppLogger } from "../logger/logger.service";
import { EmailService } from "./email.service";
import { AUTH_REDIS_CLIENT } from "./redis.provider";
import { RefreshTokenService } from "./refresh-token.service";

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    private jwtService: JwtService,
    private logger: AppLogger,
    private emailService: EmailService,
    @Inject(AUTH_REDIS_CLIENT) private readonly redis: Redis | null,
    private readonly refreshTokenService: RefreshTokenService,
  ) {}

  // ── LOGIN ───────────────────────────────────────────────────────────────
  async login(dto: LoginDto): Promise<LoginResponse> {
    try {
      const user = await this.userModel
        .findOne({ email: dto.email.toLowerCase(), active: true })
        .select("+password")
        .lean()
        .exec();

      if (!user) throw new UnauthorizedException("Credenciales invalidas");

      const ok = await bcrypt.compare(dto.password, user.password);
      if (!ok) {
        this.logger.warn(`Login fallido: ${dto.email}`, "AuthService");
        throw new UnauthorizedException("Credenciales invalidas");
      }

      const userPayload = {
        _id: String(user._id),
        email: user.email,
        role: user.role,
        tenantId: user.tenantId ? String(user.tenantId) : undefined,
      };

      const { accessToken, refreshToken } =
        await this.refreshTokenService.issueTokenPair(userPayload);

      // Resolver el slug del tenant para que el frontend pueda navegar a la URL correcta
      let tenantSlug: string | null = null;
      if (userPayload.tenantId) {
        const tenant = await this.tenantModel
          .findById(userPayload.tenantId)
          .select("slug")
          .lean()
          .exec();
        tenantSlug = tenant?.slug ?? null;
      }

      this.logger.log(`Login OK: ${user.email} [${user.role}]`, "AuthService");
      return {
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_in: this.refreshTokenService.getAccessTtlSec(),
        refresh_expires_in: this.refreshTokenService.getRefreshTtlSec(),
        user: {
          email: user.email,
          role: user.role,
          tenantId: userPayload.tenantId,
        },
        tenant_slug: tenantSlug,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.logError(error, "AuthService.login", { email: dto.email });
      throw error;
    }
  }

  // ── REFRESH ─────────────────────────────────────────────────────────────
  async refresh(refreshToken: string): Promise<RefreshTokenResponse> {
    const {
      accessToken,
      refreshToken: newRefresh,
      user,
    } = await this.refreshTokenService.rotate(refreshToken);
    this.logger.log(`Refresh OK: ${user.email} [${user.role}]`, "AuthService");
    return {
      access_token: accessToken,
      refresh_token: newRefresh,
      expires_in: this.refreshTokenService.getAccessTtlSec(),
      refresh_expires_in: this.refreshTokenService.getRefreshTtlSec(),
    };
  }

  // ── LOGOUT ──────────────────────────────────────────────────────────────
  // Idempotente: si el refresh ya no existe o es inválido, igual responde
  // success. El cliente debe borrar su estado local de todos modos.
  async logout(
    refreshToken: string,
    callerEmail?: string,
  ): Promise<LogoutResponse> {
    try {
      await this.refreshTokenService.revoke(refreshToken);
      if (callerEmail) {
        this.logger.log(`Logout OK: ${callerEmail}`, "AuthService");
      }
      return { success: true };
    } catch (error) {
      this.logger.logError(error, "AuthService.logout", { callerEmail });
      // Aunque falle, devolvemos success — el cliente debe poder cerrar
      // sesión local incluso si Redis está caído.
      return { success: true };
    }
  }

  // ── HELPER INTERNO (server-side) ────────────────────────────────────────
  // Usado por TenantService al crear un tenant + su admin en la misma
  // operación. NO valida permisos porque quien llama ya pasó por su propio
  // guard. No usar desde un controller — para eso está createUserByCaller.
  async createUser(
    email: string,
    password: string,
    role: "admin" | "kitchen",
    tenantId: string,
  ): Promise<void> {
    try {
      const hash = await bcrypt.hash(password, 12);
      await this.userModel.create({
        email: email.trim().toLowerCase(),
        password: hash,
        role,
        tenantId: new Types.ObjectId(tenantId),
        active: true,
      });
      this.logger.log(
        `Usuario creado (interno): ${email} [${role}]`,
        "AuthService",
      );
    } catch (error) {
      this.logger.logError(error, "AuthService.createUser", { email, role });
      throw error;
    }
  }

  // ── BOOTSTRAP SUPERADMIN ────────────────────────────────────────────────
  // Idempotente: si ya hay un superadmin en la DB, devuelve 409.
  // Si no hay ninguno, lee SUPERADMIN_EMAIL + SUPERADMIN_PASSWORD del .env
  // y crea al primer superadmin. Sin auth — se ejecuta una única vez al
  // arrancar un ambiente nuevo.
  async bootstrapSuperadmin(): Promise<{ email: string; role: UserRole }> {
    const existing = await this.userModel.exists({ role: "superadmin" });
    if (existing) {
      throw new ConflictException(
        "Ya existe un superadmin. Usá POST /auth/users (con JWT de superadmin) para crear más usuarios.",
      );
    }

    const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase();
    const password = process.env.SUPERADMIN_PASSWORD;

    if (!email || !password) {
      throw new InternalServerErrorException(
        "SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD deben estar definidos en .env",
      );
    }
    if (password.length < 8) {
      throw new InternalServerErrorException(
        "SUPERADMIN_PASSWORD debe tener al menos 8 caracteres",
      );
    }
    if (password === "CAMBIAR_EN_PRODUCCION") {
      throw new InternalServerErrorException(
        "SUPERADMIN_PASSWORD sigue con el placeholder del .env.example. Cambiala.",
      );
    }

    const hash = await bcrypt.hash(password, 12);
    await this.userModel.create({
      email,
      password: hash,
      role: "superadmin",
      active: true,
    });
    this.logger.log(`Superadmin bootstrap OK: ${email}`, "AuthService");
    return { email, role: "superadmin" };
  }

  // ── CREAR USUARIO DESDE EL CALLER (admin o superadmin) ──────────────────
  // Enforcea reglas de permisos según el rol del que hace la llamada:
  //   superadmin → crea cualquier rol; si es admin/kitchen, tenantId requerido.
  //   admin     → crea admin/kitchen SOLO en su propio tenant (se ignora el body.tenantId).
  //   kitchen   → 403.
  async createUserByCaller(
    caller: AuthUser,
    dto: CreateUserDto,
  ): Promise<{
    _id: string;
    email: string;
    role: UserRole;
    tenantId?: string;
    createdBy: string;
  }> {
    // kitchen nunca puede crear usuarios
    if (caller.role === "kitchen") {
      throw new ForbiddenException("Tu rol no puede crear usuarios");
    }

    // Normalizar email
    const email = dto.email.trim().toLowerCase();

    // Determinar rol + tenantId efectivos según el caller
    let effectiveTenantId: string | undefined;

    if (caller.role === "superadmin") {
      if (dto.role === "superadmin") {
        if (dto.tenantId) {
          throw new BadRequestException("Un superadmin no lleva tenantId");
        }
        effectiveTenantId = undefined;
      } else {
        // admin o kitchen → tenantId obligatorio
        if (!dto.tenantId) {
          throw new BadRequestException(
            `Para crear un ${dto.role} tenés que pasar un tenantId`,
          );
        }
        effectiveTenantId = dto.tenantId;
      }
    } else {
      // caller.role === 'admin'
      if (dto.role === "superadmin") {
        throw new ForbiddenException("Un admin no puede crear un superadmin");
      }
      if (!caller.tenantId) {
        // defensive: un admin siempre debería venir con tenantId en el JWT
        throw new ForbiddenException(
          "Tu JWT no trae tenantId — no podés crear usuarios",
        );
      }
      // Ignoramos dto.tenantId — un admin solo crea en SU tenant
      effectiveTenantId = caller.tenantId;
    }

    // Validar que el tenant exista (si aplica) — chequeo liviano con ObjectId
    if (effectiveTenantId && !Types.ObjectId.isValid(effectiveTenantId)) {
      throw new BadRequestException("tenantId no es un ObjectId valido");
    }

    // Unicidad de email
    const dup = await this.userModel.exists({ email });
    if (dup)
      throw new ConflictException(`Ya existe un usuario con el email ${email}`);

    const hash = await bcrypt.hash(dto.password, 12);
    const created = await this.userModel.create({
      email,
      password: hash,
      role: dto.role,
      active: true,
      createdBy: caller.email, // auditoría — quién creó este usuario
      ...(effectiveTenantId && {
        tenantId: new Types.ObjectId(effectiveTenantId),
      }),
    });

    this.logger.log(
      `Usuario creado por ${caller.email} [${caller.role}]: ${email} [${dto.role}]${
        effectiveTenantId ? ` @ ${effectiveTenantId}` : ""
      }`,
      "AuthService",
    );

    return {
      _id: String(created._id),
      email: created.email,
      role: created.role,
      createdBy: caller.email,
      ...(effectiveTenantId && { tenantId: effectiveTenantId }),
    };
  }

  // ── Listar usuarios ────────────────────────────────────────────────────
  // superadmin → todos, filtrable por role y tenantId.
  // admin      → solo los de su tenant (ignora filtros).
  async listUsers(
    caller: AuthUser,
    filters: { role?: string; tenantId?: string },
  ): Promise<
    {
      _id: string;
      email: string;
      role: string;
      tenantId?: string;
      active: boolean;
    }[]
  > {
    const query: Record<string, unknown> = {};

    if (caller.role === "admin") {
      // admin solo ve su propio tenant
      if (!caller.tenantId) throw new ForbiddenException("JWT sin tenantId");
      query.tenantId = new Types.ObjectId(caller.tenantId);
    } else {
      // superadmin puede filtrar opcionalmente
      if (filters.tenantId && Types.ObjectId.isValid(filters.tenantId)) {
        query.tenantId = new Types.ObjectId(filters.tenantId);
      }
      if (filters.role) query.role = filters.role;
    }

    const users = await this.userModel
      .find(query)
      .select("-password")
      .sort({ createdAt: -1 })
      .lean()
      .exec();

    return users.map((u) => ({
      _id: String(u._id),
      email: u.email,
      role: u.role,
      active: u.active,
      createdBy: (u as any).createdBy ?? null,
      ...(u.tenantId && { tenantId: String(u.tenantId) }),
    }));
  }

  // ── Reset password (forgot → reset) ────────────────────────────────────
  //
  // Flow:
  //   1. Cliente pide /auth/forgot-password con su email.
  //   2. Server genera código de 6 dígitos, lo guarda en Redis con TTL 15min,
  //      y manda email (o loguea en dev mode).
  //   3. Cliente recibe el email → entra a /reset y manda email + code +
  //      nueva password al endpoint /auth/reset-password.
  //   4. Server valida código (max 5 intentos) → hashea y actualiza.
  //
  // Seguridad:
  //   - /forgot-password SIEMPRE devuelve 200 OK (no leakeamos qué emails
  //     existen). Si el email no existe igualmente "decimos que enviamos".
  //   - Code es de 6 dígitos pero validamos con timing-safe comparison para
  //     evitar timing attacks.
  //   - Rate limit: max 5 intentos de validación. Después se invalida el code.
  //   - Si el cliente pide otro forgot mientras hay uno pendiente, lo
  //     sobrescribimos (el último gana, igual que cualquier email reset).

  /** Genera código de 6 dígitos usando random crypto-strong. */
  private generateResetCode(): string {
    const n = crypto.randomInt(0, 1_000_000);
    return n.toString().padStart(6, "0");
  }

  private resetCodeKey(email: string): string {
    return `auth:reset-code:${email.toLowerCase()}`;
  }

  /**
   * Inicia el flujo de reset. Siempre devuelve 200 con `delivered: true`
   * aunque el email no exista (anti-enumeration). El código **sólo viaja
   * por email** al usuario registrado — nunca se devuelve por la API.
   * En dev sin `RESEND_API_KEY` configurado, el código se loguea a la
   * consola del backend (banner DEV MODE) para que el desarrollador local
   * pueda probar el flow.
   */
  async forgotPassword(email: string): Promise<ForgotPasswordResponse> {
    const normalized = email.trim().toLowerCase();

    if (!this.redis) {
      // Sin Redis no podemos guardar el código. Devolvemos 503 — esto NO
      // es un caso de "el email no existe", es un problema de infra.
      throw new ServiceUnavailableException(
        "Reset password no disponible (Redis no configurado)",
      );
    }

    const user = await this.userModel
      .findOne({ email: normalized, active: true })
      .lean()
      .exec();

    // Si no existe, hacemos un sleep simulado para que el timing no delate
    // la diferencia (defense in depth).
    if (!user) {
      this.logger.warn(
        `forgot-password: email no existe o inactivo: ${normalized}`,
        "AuthService",
      );
      await new Promise((r) => setTimeout(r, 100));
      return { delivered: true };
    }

    const code = this.generateResetCode();
    // Estructura: { code, attempts: 0 }
    await this.redis.setex(
      this.resetCodeKey(normalized),
      900, // 15 min
      JSON.stringify({ code, attempts: 0 }),
    );

    const emailSubject = "Recuperá tu contraseña — FoodOrder";
    const emailText =
      `Hola,\n\n` +
      `Pediste resetear tu contraseña en FoodOrder. Tu código es:\n\n` +
      `    ${code}\n\n` +
      `El código vence en 15 minutos. Si no pediste esto, ignorá este mail.\n`;
    const emailHtml =
      `<p>Hola,</p>` +
      `<p>Pediste resetear tu contraseña en FoodOrder. Tu código es:</p>` +
      `<p style="font-size:24px;font-weight:bold;letter-spacing:4px">${code}</p>` +
      `<p>El código vence en <strong>15 minutos</strong>. Si no pediste esto, ignorá este mail.</p>`;

    await this.emailService.send({
      to: normalized,
      subject: emailSubject,
      text: emailText,
      html: emailHtml,
    });

    // En dev (sin RESEND_API_KEY) el EmailService loguea el código a la
    // consola del backend para que el desarrollador lo pueda leer durante
    // pruebas locales. El código NUNCA se devuelve en el response — el único
    // canal válido para el cliente es su email.
    this.logger.log(
      `Reset code generado para ${normalized} (TTL 15min)`,
      "AuthService",
    );

    return { delivered: true };
  }

  /**
   * Valida código y aplica nueva password. Falla con 401 unificado tanto
   * si el email no existe como si el código está mal — sigue la línea
   * anti-enumeration. Después de 5 intentos fallidos, invalida el código.
   */
  async resetPassword(
    email: string,
    code: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    const normalized = email.trim().toLowerCase();

    if (!this.redis) {
      throw new ServiceUnavailableException(
        "Reset password no disponible (Redis no configurado)",
      );
    }

    const key = this.resetCodeKey(normalized);
    const raw = await this.redis.get(key);
    if (!raw) {
      this.logger.warn(
        `reset-password: code expirado o no existe para ${normalized}`,
        "AuthService",
      );
      throw new UnauthorizedException("Código inválido o expirado");
    }

    let parsed: { code: string; attempts: number };
    try {
      parsed = JSON.parse(raw) as { code: string; attempts: number };
    } catch {
      // Cache corrupto — borramos y forzamos reintento.
      await this.redis.del(key);
      throw new UnauthorizedException("Código inválido o expirado");
    }

    // Timing-safe compare. Aunque el code sea un string de 6 dígitos cortos,
    // mantener el patrón evita errores tontos en futuros cambios.
    const submittedBuf = Buffer.from(code);
    const storedBuf = Buffer.from(parsed.code);
    const codeMatches =
      submittedBuf.length === storedBuf.length &&
      crypto.timingSafeEqual(submittedBuf, storedBuf);

    if (!codeMatches) {
      const newAttempts = parsed.attempts + 1;
      if (newAttempts >= 5) {
        await this.redis.del(key);
        this.logger.warn(
          `reset-password: 5 intentos fallidos para ${normalized}, code invalidado`,
          "AuthService",
        );
        throw new UnauthorizedException(
          "Demasiados intentos. Pedí un nuevo código.",
        );
      }
      // Mantenemos el TTL original — no extendemos la ventana por intentar.
      const ttl = await this.redis.ttl(key);
      await this.redis.setex(
        key,
        ttl > 0 ? ttl : 900,
        JSON.stringify({ code: parsed.code, attempts: newAttempts }),
      );
      throw new UnauthorizedException("Código inválido o expirado");
    }

    // Code OK — actualizamos password.
    const user = await this.userModel
      .findOne({ email: normalized, active: true })
      .exec();
    if (!user) {
      // Caso raro: code era válido pero el user fue desactivado en el medio.
      await this.redis.del(key);
      throw new UnauthorizedException("Código inválido o expirado");
    }

    const hash = await bcrypt.hash(newPassword, 12);
    user.password = hash;
    await user.save();
    await this.redis.del(key);

    this.logger.log(
      `Password reseteada exitosamente para ${normalized}`,
      "AuthService",
    );
    return { success: true };
  }

  /**
   * Cambio de password con autenticación normal (JWT + currentPassword).
   * No usa Redis — es totalmente síncrono.
   */
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<{ success: true }> {
    if (!Types.ObjectId.isValid(userId)) {
      throw new BadRequestException("userId inválido");
    }
    const user = await this.userModel
      .findOne({ _id: new Types.ObjectId(userId), active: true })
      .select("+password")
      .exec();
    if (!user) {
      throw new UnauthorizedException("Usuario no encontrado");
    }
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) {
      this.logger.warn(
        `change-password: currentPassword incorrecta para ${user.email}`,
        "AuthService",
      );
      throw new UnauthorizedException("Contraseña actual incorrecta");
    }
    if (currentPassword === newPassword) {
      throw new BadRequestException(
        "La nueva contraseña debe ser distinta de la actual",
      );
    }
    user.password = await bcrypt.hash(newPassword, 12);
    await user.save();
    this.logger.log(`Password cambiada para ${user.email}`, "AuthService");
    return { success: true };
  }
}
