import { api } from "./client";

// ── Tipos compartidos ─────────────────────────────────────────────────────────

export interface FinancialDocumentItem {
  description: string;
  quantity?: number | null;
  unitPrice?: number | null;
  total?: number | null;
}

export interface FinancialDocument {
  _id: string;
  tenantId: string;
  type: "ingreso" | "egreso";
  date: string; // ISO date string
  supplier: string;
  amount: number;
  currency: "USD" | "VES";
  description: string;
  items: FinancialDocumentItem[];
  category?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  documentUrl?: string;
  documentPublicId?: string;
  status: "active" | "deleted";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface FinanceSummary {
  totalIngresos: number;
  totalEgresos: number;
  balance: number;
  countIngresos: number;
  countEgresos: number;
  periodLabel: string;
  byCategory?: { category: string; total: number; count: number }[];
}

export interface ChartMonth {
  label: string;
  month: string;
  ingresos: number;
  egresos: number;
  balance: number;
}

export interface FinanceListResponse {
  docs: FinancialDocument[];
  total: number;
}

export interface CreateFinancialDocumentInput {
  type: "ingreso" | "egreso";
  date: string;
  supplier?: string;
  amount: number;
  currency: "USD" | "VES";
  description?: string;
  items?: FinancialDocumentItem[];
  category?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
  extractedData?: unknown;
  file?: File;
}

export interface UpdateFinancialDocumentInput {
  type?: "ingreso" | "egreso";
  date?: string;
  supplier?: string;
  amount?: number;
  currency?: "USD" | "VES";
  description?: string;
  items?: FinancialDocumentItem[];
  category?: string | null;
  subtotal?: number | null;
  taxAmount?: number | null;
}

export interface FinanceListParams {
  type?: "ingreso" | "egreso" | "";
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  category?: string;
}

// ── Datos del extractor LLM ───────────────────────────────────────────────────

export interface FinanceDocumentExtracted {
  isValidDocument: boolean;
  documentType: "invoice" | "receipt" | "delivery_note" | "other" | null;
  type: "ingreso" | "egreso" | null;
  date: string | null;
  supplier: string | null;
  description: string | null;
  amount: number | null;
  currency: "USD" | "VES" | null;
  items: FinancialDocumentItem[];
  subtotal?: number | null;
  taxAmount?: number | null;
  confidence: "high" | "medium" | "low";
  notes: string | null;
}

// ── API client ────────────────────────────────────────────────────────────────

export const financeApi = {
  summary(
    params: { dateFrom?: string; dateTo?: string } = {},
  ): Promise<FinanceSummary> {
    const p: Record<string, unknown> = { ...params };
    if (!p["dateFrom"]) delete p["dateFrom"];
    if (!p["dateTo"]) delete p["dateTo"];
    return api
      .get<FinanceSummary>("/admin/finance/summary", { params: p })
      .then((r) => r.data);
  },

  list(params: FinanceListParams = {}): Promise<FinanceListResponse> {
    const p: Record<string, unknown> = { ...params };
    if (!p["type"]) delete p["type"];
    if (!p["dateFrom"]) delete p["dateFrom"];
    if (!p["dateTo"]) delete p["dateTo"];
    if (!p["category"]) delete p["category"];
    return api
      .get<FinanceListResponse>("/admin/finance/documents", { params: p })
      .then((r) => r.data);
  },

  chart(months = 6): Promise<ChartMonth[]> {
    return api
      .get<ChartMonth[]>("/admin/finance/chart", { params: { months } })
      .then((r) => r.data);
  },

  async exportCsv(params: {
    dateFrom?: string;
    dateTo?: string;
    type?: string;
    category?: string;
  }): Promise<void> {
    const p: Record<string, unknown> = { ...params };
    if (!p["type"]) delete p["type"];
    if (!p["dateFrom"]) delete p["dateFrom"];
    if (!p["dateTo"]) delete p["dateTo"];
    if (!p["category"]) delete p["category"];
    const res = await api.get("/admin/finance/export", {
      params: p,
      responseType: "blob",
    });
    const url = URL.createObjectURL(
      new Blob([res.data as BlobPart], { type: "text/csv" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `finanzas-${params.dateFrom ?? "todo"}-${params.dateTo ?? ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  async create(
    input: CreateFinancialDocumentInput,
  ): Promise<FinancialDocument> {
    const formData = new FormData();
    formData.append("type", input.type);
    formData.append("date", input.date);
    formData.append("amount", String(input.amount));
    formData.append("currency", input.currency);
    if (input.supplier) formData.append("supplier", input.supplier);
    if (input.description) formData.append("description", input.description);
    if (input.category) formData.append("category", input.category);
    if (input.subtotal != null)
      formData.append("subtotal", String(input.subtotal));
    if (input.taxAmount != null)
      formData.append("taxAmount", String(input.taxAmount));
    if (input.items) formData.append("items", JSON.stringify(input.items));
    if (input.extractedData)
      formData.append("extractedData", JSON.stringify(input.extractedData));
    if (input.file) formData.append("file", input.file);

    return api
      .post<FinancialDocument>("/admin/finance/documents", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      })
      .then((r) => r.data);
  },

  update(
    id: string,
    input: UpdateFinancialDocumentInput,
  ): Promise<FinancialDocument> {
    return api
      .patch<FinancialDocument>(`/admin/finance/documents/${id}`, input)
      .then((r) => r.data);
  },

  softDelete(id: string): Promise<{ ok: boolean }> {
    return api
      .delete<{ ok: boolean }>(`/admin/finance/documents/${id}`)
      .then((r) => r.data);
  },

  async extractDocument(
    tenantSlug: string,
    file: File,
  ): Promise<{
    data: FinanceDocumentExtracted;
    provider: string;
    latencyMs: number;
    cached: boolean;
  }> {
    const formData = new FormData();
    formData.append("image", file);
    const res = await api.post(
      `/${tenantSlug}/extract/finance-document`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return res.data as {
      data: FinanceDocumentExtracted;
      provider: string;
      latencyMs: number;
      cached: boolean;
    };
  },
};
