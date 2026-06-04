export type QrPageType = 'fixed_amount' | 'product_selection' | 'open_amount';

export interface QrPage {
  _id: string;
  tenantId: string;
  tenantSlug: string;
  createdBy: string;
  shortCode: string;
  title: string;
  description: string | null;
  type: QrPageType;
  amount: number | null;
  productIds: string[];
  allowQuantity: boolean;
  paymentMethods: string[];
  defaultPaymentMethod: string;
  paymentAccountId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface QrPageProduct {
  _id: string;
  name: string;
  price: number;
  image_url?: string | null;
  category?: string;
}

export interface QrPagePublicConfig {
  isActive: boolean;
  qrPage?: {
    _id: string;
    title: string;
    description: string | null;
    type: QrPageType;
    amount: number | null;
    allowQuantity: boolean;
    paymentMethods: string[];
    defaultPaymentMethod: string;
  };
  products?: QrPageProduct[];
  bankAccountSnapshot?: Record<string, unknown> | null;
}

export interface CreatePaymentFromQrDto {
  items?: { productId: string; quantity: number }[];
  amount?: number;
  paymentMethod: string;
  customerName?: string;
}

export interface CreateQrPageDto {
  shortCode: string;
  title: string;
  description?: string;
  type: QrPageType;
  amount?: number;
  productIds?: string[];
  allowQuantity?: boolean;
  paymentMethods: string[];
  defaultPaymentMethod: string;
  paymentAccountId?: string;
  isActive?: boolean;
}

export type UpdateQrPageDto = Partial<Omit<CreateQrPageDto, 'shortCode'>>;
