import { api } from "./client";
import type { BankAccount } from "@foodorder/types";

export interface BankAccountDto {
  bank: string;
  bankCode?: string;
  phone: string;
  rif: string;
  accountHolder: string;
  qrRawPayload?: string;
}

export const bankAccountsApi = {
  list: () =>
    api.get<BankAccount[]>("/tenants/me/bank-accounts").then((r) => r.data),

  create: (dto: BankAccountDto) =>
    api
      .post<BankAccount[]>("/tenants/me/bank-accounts", dto)
      .then((r) => r.data),

  update: (accountId: string, dto: BankAccountDto) =>
    api
      .patch(`/tenants/me/bank-accounts/${accountId}`, dto)
      .then((r) => r.data),

  setDefault: (accountId: string) =>
    api
      .patch<BankAccount>(`/tenants/me/bank-accounts/${accountId}/default`)
      .then((r) => r.data),

  remove: (accountId: string) =>
    api
      .delete<BankAccount>(`/tenants/me/bank-accounts/${accountId}`)
      .then((r) => r.data),

  /** Sube imagen del QR S7B a Cloudinary. Opcionalmente envía el payload decodificado. */
  uploadQr: (accountId: string, file: File, qrRawPayload?: string) => {
    const fd = new FormData();
    fd.append("file", file);
    if (qrRawPayload) fd.append("qrRawPayload", qrRawPayload);
    return api
      .post(`/tenants/me/bank-accounts/${accountId}/qr`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },

  deleteQr: (accountId: string) =>
    api.delete(`/tenants/me/bank-accounts/${accountId}/qr`).then((r) => r.data),
};
