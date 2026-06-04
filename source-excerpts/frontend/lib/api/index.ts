/**
 * Barrel del cliente API.
 *
 * Mantiene la compat con `import { api } from '../lib/api'` (la instancia
 * axios cruda) y agrega los módulos de dominio para que los call-sites
 * usen funciones tipadas en vez de strings sueltos.
 */

export { api, getLastTraceId, downloadCsv } from "./client";

export { ordersApi } from "./orders";
export type {
  CreateOrderDto,
  CreateOrderItem,
  SubmitPagomovilDto,
  VerifyPagomovilDto,
  UpdateOrderStatusDto,
} from "./orders";

export { tenantsApi } from "./tenants";
export type { UpdateTenantDto } from "./tenants";

export { bankAccountsApi } from "./bank-accounts";
export type { BankAccountDto } from "./bank-accounts";

export { productsApi, menuApi } from "./products";
export type { ProductDto } from "./products";

export { analyticsApi } from "./analytics";
export type {
  AnalyticsDateRange,
  AnalyticsOrdersFilter,
  DailySummary,
  TopProduct,
  RevenueByDay,
} from "./analytics";

export { paymentsApi } from "./payments";
export type { PaymentsFilter, SaveArqueoDto } from "./payments";

export { authApi } from "./auth";
export type { CreateUserDto, AppUser } from "./auth";

export { pushApi } from "./push";
export type { PushSubscriptionDto } from "./push";

export { tenantConfigApi } from "./tenant-config";
export type { TenantConfig } from "./tenant-config";

export { extractionApi } from "./extraction";
export type {
  ExtractionResponse,
  ExtractionContext,
  PagomovilReceiptData,
  TransferReceiptData,
  ZelleReceiptData,
} from "./extraction";

export { transferAccountsApi } from "./transfer-accounts";
export { zelleAccountsApi } from "./zelle-accounts";

export { ratesApi } from "./rates";

export { financeApi } from "./finance";
export type {
  FinancialDocument,
  FinancialDocumentItem,
  FinanceSummary,
  FinanceListResponse,
  FinanceListParams,
  CreateFinancialDocumentInput,
  UpdateFinancialDocumentInput,
  FinanceDocumentExtracted,
} from "./finance";
