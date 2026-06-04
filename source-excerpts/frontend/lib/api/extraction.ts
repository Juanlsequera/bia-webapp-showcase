import { api } from "./client";
import type { ParsedReceipt } from "../ocr/types";

/** Shape completo del response del backend */
export interface ExtractionResponse<T = PagomovilReceiptData> {
  type: string;
  data: T;
  cached: boolean;
  provider: string;
  latencyMs: number;
}

/** Datos que devuelve el LLM para un comprobante de transferencia bancaria */
export interface TransferReceiptData {
  isValidDocument: boolean;
  bank: string | null;
  destinationBank: string | null;
  amount: number | null;
  currency: "USD" | "VES" | null;
  date: string | null;
  time: string | null;
  reference: string | null;
  senderName: string | null;
  recipientName: string | null;
  recipientAccount: string | null;
  concept: string | null;
  confidence: "high" | "medium" | "low";
  notes: string | null;
}

/** Datos que devuelve el LLM para un comprobante Zelle */
export interface ZelleReceiptData {
  isValidDocument: boolean;
  amount: number | null;
  currency: "USD" | null;
  date: string | null;
  time: string | null;
  reference: string | null;
  senderEmail: string | null;
  recipientEmail: string | null;
  senderName: string | null;
  recipientName: string | null;
  memo: string | null;
  bankApp: string | null;
  confidence: "high" | "medium" | "low";
  notes: string | null;
}

/** Datos que devuelve el LLM para un comprobante PagoMóvil */
export interface PagomovilReceiptData {
  isValidReceipt: boolean;
  reference: string | null;
  amount: number | null;
  date: string | null;
  beneficiaryPhone: string | null;
  beneficiaryCedula: string | null;
  beneficiaryName: string | null;
  beneficiaryBank: string | null;
  issuerBank: string | null;
  confidence: "high" | "medium" | "low";
}

export interface ExtractionContext {
  expectedAmount?: number;
  expectedBeneficiaryPhone?: string;
}

export const extractionApi = {
  async extractTransferReceipt(
    tenantSlug: string,
    image: File,
  ): Promise<{
    data: TransferReceiptData;
    provider: string;
    latencyMs: number;
  }> {
    const formData = new FormData();
    formData.append("image", image);
    const res = await api.post<ExtractionResponse<TransferReceiptData>>(
      `/${tenantSlug}/extract/transfer-receipt`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return {
      data: res.data.data,
      provider: res.data.provider,
      latencyMs: res.data.latencyMs,
    };
  },

  async extractZelleReceipt(
    tenantSlug: string,
    image: File,
  ): Promise<{ data: ZelleReceiptData; provider: string; latencyMs: number }> {
    const formData = new FormData();
    formData.append("image", image);
    const res = await api.post<ExtractionResponse<ZelleReceiptData>>(
      `/${tenantSlug}/extract/zelle-receipt`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return {
      data: res.data.data,
      provider: res.data.provider,
      latencyMs: res.data.latencyMs,
    };
  },

  /**
   * Extrae datos de un comprobante PagoMóvil usando el LLM del backend.
   *
   * Reemplaza el OCR client-side (Tesseract) — misma interfaz de salida
   * pero sin los 5MB de bundle ni las regexes por banco.
   *
   * @returns `{ receipt, isValidReceipt, provider, latencyMs }`
   *   - `isValidReceipt: false` → la imagen no es un comprobante PagoMóvil
   *   - `isValidReceipt: true`  → fields extraídos (algunos pueden ser null)
   */
  async extractPagomovilReceipt(
    tenantSlug: string,
    image: File,
    context?: ExtractionContext,
  ): Promise<{
    receipt: ParsedReceipt;
    isValidReceipt: boolean;
    confidence: PagomovilReceiptData["confidence"];
    provider: string;
    latencyMs: number;
  }> {
    const formData = new FormData();
    formData.append("image", image);
    if (context?.expectedAmount != null) {
      formData.append("expectedAmount", String(context.expectedAmount));
    }
    if (context?.expectedBeneficiaryPhone) {
      formData.append(
        "expectedBeneficiaryPhone",
        context.expectedBeneficiaryPhone,
      );
    }

    const res = await api.post<ExtractionResponse>(
      `/${tenantSlug}/extract/pagomovil-receipt`,
      formData,
      { headers: { "Content-Type": "multipart/form-data" } },
    );

    const d = res.data.data;

    // Mapear PagomovilReceiptData → ParsedReceipt (shape que ya usa el frontend)
    const receipt: ParsedReceipt = {
      reference: d.reference ?? undefined,
      amount: d.amount ?? undefined,
      date: d.date ?? undefined,
      beneficiaryPhone: d.beneficiaryPhone ?? undefined,
      beneficiaryCedula: d.beneficiaryCedula ?? undefined,
      beneficiaryName: d.beneficiaryName ?? undefined,
      beneficiaryBank: d.beneficiaryBank ?? undefined,
    };

    return {
      receipt,
      isValidReceipt: d.isValidReceipt,
      confidence: d.confidence,
      provider: res.data.provider,
      latencyMs: res.data.latencyMs,
    };
  },
};
