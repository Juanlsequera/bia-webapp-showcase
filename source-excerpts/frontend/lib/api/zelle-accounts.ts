import { api } from "./client";
import type {
  ZelleAccount,
  CreateZelleAccountDto,
  UpdateZelleAccountDto,
} from "@foodorder/types";

export const zelleAccountsApi = {
  list: () =>
    api.get<ZelleAccount[]>("/tenants/me/zelle-accounts").then((r) => r.data),

  create: (dto: CreateZelleAccountDto) =>
    api
      .post<ZelleAccount[]>("/tenants/me/zelle-accounts", dto)
      .then((r) => r.data),

  update: (accountId: string, dto: UpdateZelleAccountDto) =>
    api
      .patch<ZelleAccount[]>(`/tenants/me/zelle-accounts/${accountId}`, dto)
      .then((r) => r.data),

  setDefault: (accountId: string) =>
    api
      .patch<ZelleAccount[]>(`/tenants/me/zelle-accounts/${accountId}/default`)
      .then((r) => r.data),

  remove: (accountId: string) =>
    api
      .delete<ZelleAccount[]>(`/tenants/me/zelle-accounts/${accountId}`)
      .then((r) => r.data),
};
