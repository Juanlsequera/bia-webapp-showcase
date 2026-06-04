export type UserRole = "superadmin" | "admin" | "kitchen";
export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
  tenantId?: string;
  jti?: string;
  iat?: number;
  exp?: number;
}
export interface AuthUser {
  _id: string;
  email: string;
  role: UserRole;
  tenantId?: string;
}
export interface LoginDto {
  email: string;
  password: string;
}
export interface LoginResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number; // TTL access en segundos
  refresh_expires_in: number; // TTL refresh en segundos
  user: Omit<AuthUser, "_id">;
  /** Slug del tenant al que pertenece el usuario. null para superadmin o roles sin tenant. */
  tenant_slug: string | null;
}

export interface RefreshTokenDto {
  refresh_token: string;
}

export interface RefreshTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_expires_in: number;
}

export interface LogoutDto {
  refresh_token: string;
}

export interface LogoutResponse {
  success: boolean;
}

// ── Reset / change password ──────────────────────────────────────────────

export interface ForgotPasswordDto {
  email: string;
}

/**
 * El back siempre devuelve 200 con `delivered: true` para evitar leakear
 * la existencia de cuentas. Si en realidad el email no existe, igualmente
 * devuelve este mismo shape — la diferencia se ve sólo en logs server-side.
 *
 * Nota de seguridad: el código de reset NUNCA se incluye en este payload.
 * El único canal válido para recibirlo es el email registrado del usuario
 * (o, en dev, la consola del backend para que el dev pueda probar localmente).
 */
export interface ForgotPasswordResponse {
  delivered: boolean;
}

export interface ResetPasswordDto {
  email: string;
  code: string;
  newPassword: string;
}

export interface ChangePasswordDto {
  currentPassword: string;
  newPassword: string;
}
