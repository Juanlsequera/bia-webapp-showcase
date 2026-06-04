import { api } from "./client";
import type {
  TransferAccount,
  CreateTransferAccountDto,
  UpdateTransferAccountDto,
} from "@foodorder/types";

export const transferAccountsApi = {
  list: () =>
    api
      .get<TransferAccount[]>("/tenants/me/transfer-accounts")
      .then((r) => r.data),

  create: (dto: CreateTransferAccountDto) =>
    api
      .post<TransferAccount[]>("/tenants/me/transfer-accounts", dto)
      .then((r) => r.data),

  update: (accountId: string, dto: UpdateTransferAccountDto) =>
    api
      .patch<
        TransferAccount[]
      >(`/tenants/me/transfer-accounts/${accountId}`, dto)
      .then((r) => r.data),

  setDefault: (accountId: string) =>
    api
      .patch<
        TransferAccount[]
      >(`/tenants/me/transfer-accounts/${accountId}/default`)
      .then((r) => r.data),

  remove: (accountId: string) =>
    api
      .delete<TransferAccount[]>(`/tenants/me/transfer-accounts/${accountId}`)
      .then((r) => r.data),
};
