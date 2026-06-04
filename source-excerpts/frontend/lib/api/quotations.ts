import type {
  Quotation,
  QuotationListResult,
  QuotationStatus,
  LaborLine,
} from "@foodorder/types";
import { api } from "./index";

export interface CreateQuotationPayload {
  clientName: string;
  clientCompany?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientRif?: string;
  title?: string;
  date: string;
  validUntil: string;
  items: {
    description: string;
    quantity: number;
    unit: string;
    unitPrice: number;
    subtotal: number;
  }[];
  laborLines?: LaborLine[];
  ivaEnabled: boolean;
  ivaRate?: number;
  notes?: string;
  internalNotes?: string;
  currency?: string;
}

export const quotationsApi = {
  list: (params?: {
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }): Promise<QuotationListResult> =>
    api
      .get<QuotationListResult>("/admin/quotations", { params })
      .then((r) => r.data),

  create: (data: CreateQuotationPayload): Promise<Quotation> =>
    api.post<Quotation>("/admin/quotations", data).then((r) => r.data),

  getOne: (id: string): Promise<Quotation> =>
    api.get<Quotation>(`/admin/quotations/${id}`).then((r) => r.data),

  update: (
    id: string,
    data: Partial<CreateQuotationPayload>,
  ): Promise<Quotation> =>
    api.patch<Quotation>(`/admin/quotations/${id}`, data).then((r) => r.data),

  updateStatus: (id: string, status: QuotationStatus): Promise<Quotation> =>
    api
      .patch<Quotation>(`/admin/quotations/${id}/status`, { status })
      .then((r) => r.data),

  remove: (id: string): Promise<void> =>
    api.delete(`/admin/quotations/${id}`).then(() => undefined),
};
