import { api } from "./client";
import type {
  LoginResponse,
  RefreshTokenResponse,
  LogoutResponse,
} from "@foodorder/types";

export interface CreateUserDto {
  email: string;
  password: string;
  role: "admin" | "kitchen";
  tenantId?: string;
}

export interface AppUser {
  _id: string;
  email: string;
  role: string;
  active: boolean;
  tenantId?: string;
}

export const authApi = {
  login: (email: string, password: string) =>
    api
      .post<LoginResponse>("/auth/login", { email, password })
      .then((r) => r.data),

  /** Rota el par usando el refresh_token actual. El interceptor de axios ya
   *  lo llama automáticamente ante 401 — este helper queda expuesto por si
   *  algún flow lo necesita manualmente. */
  refresh: (refresh_token: string) =>
    api
      .post<RefreshTokenResponse>("/auth/refresh", { refresh_token })
      .then((r) => r.data),

  /** Cierra la sesión actual. Idempotente: si el refresh ya no existe,
   *  igual responde success. */
  logout: (refresh_token: string) =>
    api
      .post<LogoutResponse>("/auth/logout", { refresh_token })
      .then((r) => r.data),

  forgotPassword: (email: string) =>
    api.post("/auth/forgot-password", { email }).then((r) => r.data),

  resetPassword: (email: string, code: string, newPassword: string) =>
    api
      .post("/auth/reset-password", { email, code, newPassword })
      .then((r) => r.data),

  changePassword: (currentPassword: string, newPassword: string) =>
    api
      .post("/auth/change-password", { currentPassword, newPassword })
      .then((r) => r.data),

  /** Lista usuarios del tenant actual (admin) o de todos (superadmin). */
  listUsers: <T = AppUser>() => api.get<T[]>("/auth/users").then((r) => r.data),

  createUser: <T = AppUser>(dto: CreateUserDto) =>
    api.post<T>("/auth/users", dto).then((r) => r.data),
};
