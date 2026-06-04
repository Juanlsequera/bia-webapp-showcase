export interface QuotationItem {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  subtotal: number;
}

export interface LaborLine {
  description: string;
  hours: number;
  ratePerHour: number;
  fixedPrice: number;
  subtotal: number;
}

export type QuotationStatus =
  | "draft"
  | "sent"
  | "accepted"
  | "rejected"
  | "expired";

export interface Quotation {
  _id: string;
  tenantId: string;
  number: string;
  status: QuotationStatus;

  // Client
  clientName: string;
  clientCompany?: string;
  clientEmail?: string;
  clientPhone?: string;
  clientRif?: string;

  // Meta
  title?: string;
  date: string;
  validUntil: string;
  currency: string;

  // Items
  items: QuotationItem[];
  laborLines?: LaborLine[];

  // Totals
  ivaEnabled: boolean;
  ivaRate: number;
  materialsSubtotal?: number;
  laborSubtotal?: number;
  subtotal: number;
  ivaAmount: number;
  total: number;

  // Notes
  notes?: string;
  internalNotes?: string;

  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuotationListResult {
  docs: Quotation[];
  total: number;
  page: number;
  limit: number;
}
