import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  PaymentTransaction,
  PaymentTransactionDocument,
} from "./schemas/payment-transaction.schema";
import { CajaArqueo, CajaArqueoDocument } from "./schemas/caja-arqueo.schema";
import { AppLogger } from "../logger/logger.service";
import { PaymentTransactionsQueryDto } from "./dto/payment-query.dto";
import { SaveArqueoDto } from "./dto/arqueo.dto";
import {
  PaymentTransactionListItem,
  PaymentClosingSummary,
  PaymentTransactionsResponse,
  PaymentTransactionMethod,
  PaymentTransactionStatus,
  PaymentCrossCheck,
  CajaArqueo as CajaArqueoType,
} from "@foodorder/types";

export interface CreatePagomovilTransactionInput {
  tenantId: string;
  orderId: string;
  traceId: string;
  amount: number;
  reference?: string | null;
  senderPhone?: string | null;
  senderBank?: string | null;
  beneficiaryPhone?: string | null;
  beneficiaryBank?: string | null;
  crossCheckStatus?: "match" | "mismatch" | "unknown";
  /** URL del comprobante en Cloudinary (P1.13). Null si el cliente no subió imagen. */
  receipt_url?: string | null;
}

export interface ReviewTransactionInput {
  orderId: string;
  reviewedBy: string;
  decision: "approved" | "rejected";
  rejectionReason?: string | null;
}

/**
 * Servicio fino sobre `payment_transactions`. Creado para:
 *   - Dejar trazabilidad del comprobante que subió el cliente.
 *   - Permitir cerrar caja (listado del día).
 *   - Auditar reintentos y decisiones del admin.
 */
@Injectable()
export class PaymentTransactionService {
  constructor(
    @InjectModel(PaymentTransaction.name)
    private readonly model: Model<PaymentTransactionDocument>,
    @InjectModel(CajaArqueo.name)
    private readonly arqueoModel: Model<CajaArqueoDocument>,
    private readonly logger: AppLogger,
  ) {}

  /** Crea un registro en `pending_review` tras el submit de pagomovil. */
  async createPagomovilPending(
    input: CreatePagomovilTransactionInput,
  ): Promise<PaymentTransactionDocument> {
    try {
      const trx = await this.model.create({
        tenantId: new Types.ObjectId(input.tenantId),
        orderId: new Types.ObjectId(input.orderId),
        traceId: input.traceId,
        method: "pagomovil",
        status: "pending_review",
        amount: input.amount,
        reference: input.reference ?? null,
        senderPhone: input.senderPhone ?? null,
        senderBank: input.senderBank ?? null,
        beneficiaryPhone: input.beneficiaryPhone ?? null,
        beneficiaryBank: input.beneficiaryBank ?? null,
        crossCheckStatus: input.crossCheckStatus ?? "unknown",
        receipt_url: input.receipt_url ?? null,
      });

      this.logger.log(
        `Transaction creada: ${String(trx._id)} | order=${input.orderId} | ` +
          `ref=${input.reference ?? "-"} | monto=${input.amount}`,
        "PaymentTransactionService",
        input.traceId,
      );

      return trx;
    } catch (error) {
      this.logger.logError(
        error,
        "PaymentTransactionService.createPagomovilPending",
        { orderId: input.orderId },
        input.traceId,
      );
      throw error;
    }
  }

  /**
   * Crea un registro `approved` inmediatamente cuando el cajero confirma un pago
   * en efectivo o débito. A diferencia de PagoMóvil (que crea `pending_review`
   * y luego lo aprueba), el cash/debit se acepta en un solo paso.
   * La transacción queda con `reviewedBy = operatorEmail` para la auditoría de caja.
   */
  async createCashTransaction(input: {
    tenantId: string;
    orderId: string;
    traceId: string;
    method: "cash" | "debit_card";
    /** USD para cash, Bs. para debit_card */
    amount: number;
    confirmedBy: string;
  }): Promise<PaymentTransactionDocument> {
    try {
      const now = new Date();
      const trx = await this.model.create({
        tenantId: new Types.ObjectId(input.tenantId),
        orderId: new Types.ObjectId(input.orderId),
        traceId: input.traceId,
        method: input.method,
        status: "approved",
        amount: input.amount,
        reference: null,
        senderPhone: null,
        senderBank: null,
        beneficiaryPhone: null,
        beneficiaryBank: null,
        crossCheckStatus: "unknown",
        receipt_url: null,
        reviewedBy: input.confirmedBy,
        reviewedAt: now,
        rejectionReason: null,
      });

      this.logger.log(
        `Transaction ${input.method} aprobada: ${String(trx._id)} | order=${input.orderId} | ` +
          `monto=${input.amount} | por=${input.confirmedBy}`,
        "PaymentTransactionService",
        input.traceId,
      );

      return trx;
    } catch (error) {
      this.logger.logError(
        error,
        "PaymentTransactionService.createCashTransaction",
        { orderId: input.orderId },
        input.traceId,
      );
      throw error;
    }
  }

  /**
   * Actualiza la transacción más reciente de una orden con la decisión del
   * admin. Si el cliente reintentó y hay varias, tocamos la última en
   * `pending_review` — que es la que corresponde al ciclo actual.
   */
  async applyReview(
    input: ReviewTransactionInput,
    traceId?: string,
  ): Promise<PaymentTransactionDocument | null> {
    try {
      const trx = await this.model
        .findOneAndUpdate(
          {
            orderId: new Types.ObjectId(input.orderId),
            status: "pending_review",
          },
          {
            $set: {
              status: input.decision,
              reviewedBy: input.reviewedBy,
              reviewedAt: new Date(),
              rejectionReason: input.rejectionReason ?? null,
            },
          },
          { new: true, sort: { createdAt: -1 } },
        )
        .exec();

      if (!trx) {
        // No rompemos — la orden puede haberse revisado antes de tener el
        // sistema de transactions; loggeamos para que quede rastro y seguimos.
        this.logger.warn(
          `Transaction no encontrada para review: order=${input.orderId} ` +
            `(probablemente orden pre-feature).`,
          "PaymentTransactionService",
          traceId,
        );
        return null;
      }

      this.logger.log(
        `Transaction ${input.decision}: ${String(trx._id)} por ${input.reviewedBy}` +
          (input.rejectionReason ? ` — ${input.rejectionReason}` : ""),
        "PaymentTransactionService",
        traceId,
      );

      return trx;
    } catch (error) {
      this.logger.logError(
        error,
        "PaymentTransactionService.applyReview",
        { orderId: input.orderId },
        traceId,
      );
      throw error;
    }
  }

  /**
   * Lista transacciones del día (o rango) para un tenant. Base del "cerrar
   * caja" — hoy lo deja listo; cuando expongamos endpoint será un método más
   * en payment.controller consumiendo esto.
   */
  async listByDateRange(
    tenantId: string,
    from: Date,
    to: Date,
    status?: "pending_review" | "approved" | "rejected",
  ): Promise<PaymentTransactionDocument[]> {
    const query: Record<string, unknown> = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: from, $lte: to },
    };
    if (status) query.status = status;

    return this.model
      .find(query)
      .sort({ createdAt: -1 })
      .lean()
      .exec() as unknown as PaymentTransactionDocument[];
  }

  // ── Cerrar caja ────────────────────────────────────────────────────────

  /**
   * Listado paginado + summary agregado del rango. Endpoint principal del
   * dashboard "cerrar caja". Una sola llamada al back resuelve ambas cosas
   * (data + totales) — no queremos hacer 2 round-trips desde el front.
   */
  async listForClosing(
    tenantId: string,
    query: PaymentTransactionsQueryDto,
  ): Promise<PaymentTransactionsResponse> {
    const { from, to, periodLabel } = this.resolvePeriod(query);
    const filter: Record<string, unknown> = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: from, $lte: to },
    };
    if (query.status) filter.status = query.status;
    if (query.method) filter.method = query.method;

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));

    // Ejecutamos data + count + summary en paralelo. El summary va sobre el
    // rango COMPLETO ignorando paginación (queremos los totales del día,
    // no de "los 50 que estoy viendo").
    const [docs, total, summary] = await Promise.all([
      this.model
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean()
        .exec() as unknown as Promise<PaymentTransactionDocument[]>,
      this.model.countDocuments(filter).exec(),
      this.buildClosingSummary(tenantId, from, to, periodLabel, {
        // El summary respeta los filtros de método pero NO el de status
        // (queremos ver pending vs approved vs rejected todos juntos).
        method: query.method,
      }),
    ]);

    return {
      data: docs.map((d) => this.toListItem(d)),
      total,
      page,
      limit,
      summary,
    };
  }

  /**
   * Sólo el summary (sin data). Útil para un widget "estado de caja" en el
   * dashboard sin tener que pagar el costo del listado.
   */
  async getClosingSummary(
    tenantId: string,
    query: PaymentTransactionsQueryDto,
  ): Promise<PaymentClosingSummary> {
    const { from, to, periodLabel } = this.resolvePeriod(query);
    return this.buildClosingSummary(tenantId, from, to, periodLabel, {
      method: query.method,
    });
  }

  /**
   * CSV con BOM UTF-8 (Excel-friendly). Una columna por campo relevante
   * + traceId al final para correlación. Cap 5000 filas igual que analytics.
   */
  async exportClosingCsv(
    tenantId: string,
    query: PaymentTransactionsQueryDto,
  ): Promise<string> {
    const { from, to } = this.resolvePeriod(query);
    const filter: Record<string, unknown> = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: from, $lte: to },
    };
    if (query.status) filter.status = query.status;
    if (query.method) filter.method = query.method;

    const docs = (await this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean()
      .exec()) as unknown as PaymentTransactionDocument[];

    const header = [
      "createdAt",
      "method",
      "status",
      "amount",
      "reference",
      "senderPhone",
      "senderBank",
      "beneficiaryPhone",
      "crossCheck",
      "reviewedBy",
      "reviewedAt",
      "rejectionReason",
      "orderId",
      "traceId",
    ];

    const rows = docs.map((d) => [
      (d as unknown as { createdAt: Date }).createdAt.toISOString(),
      d.method,
      d.status,
      String(d.amount),
      d.reference ?? "",
      d.senderPhone ?? "",
      d.senderBank ?? "",
      d.beneficiaryPhone ?? "",
      d.crossCheckStatus ?? "unknown",
      d.reviewedBy ?? "",
      d.reviewedAt ? new Date(d.reviewedAt).toISOString() : "",
      d.rejectionReason ?? "",
      String(d.orderId),
      d.traceId ?? "",
    ]);

    const BOM = "﻿";
    const csv =
      BOM +
      [header, ...rows]
        .map((cols) => cols.map(this.csvEscape).join(","))
        .join("\n");

    this.logger.log(
      `CSV cierre caja: tenant=${tenantId} | rango=${from
        .toISOString()
        .slice(0, 10)}→${to.toISOString().slice(0, 10)} | filas=${rows.length}`,
      "PaymentTransactionService",
    );

    return csv;
  }

  // ── helpers privados ───────────────────────────────────────────────────

  /**
   * Construye el summary con MongoDB Aggregation. Hace un único $match por
   * el rango y agrupa por método + status, después lo aplanamos en JS.
   */
  private async buildClosingSummary(
    tenantId: string,
    from: Date,
    to: Date,
    periodLabel: string,
    opts: { method?: PaymentTransactionMethod },
  ): Promise<PaymentClosingSummary> {
    const match: Record<string, unknown> = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: from, $lte: to },
    };
    if (opts.method) match.method = opts.method;

    type AggRow = {
      _id: {
        method: PaymentTransactionMethod;
        status: PaymentTransactionStatus;
      };
      count: number;
      sumAmount: number;
    };

    const rows = (await this.model.aggregate<AggRow>([
      { $match: match },
      {
        $group: {
          _id: { method: "$method", status: "$status" },
          count: { $sum: 1 },
          sumAmount: { $sum: "$amount" },
        },
      },
    ])) as AggRow[];

    // Acumuladores globales
    let totalCount = 0;
    let approvedCount = 0;
    let rejectedCount = 0;
    let pendingCount = 0;

    // Por método: { method → { count, approvedAmount, pendingAmount } }
    const byMethodMap = new Map<
      PaymentTransactionMethod,
      { count: number; approvedAmount: number; pendingAmount: number }
    >();

    for (const r of rows) {
      const { method, status } = r._id;
      totalCount += r.count;
      if (status === "approved") approvedCount += r.count;
      else if (status === "rejected") rejectedCount += r.count;
      else pendingCount += r.count;

      const bucket = byMethodMap.get(method) ?? {
        count: 0,
        approvedAmount: 0,
        pendingAmount: 0,
      };
      bucket.count += r.count;
      if (status === "approved") bucket.approvedAmount += r.sumAmount;
      else if (status === "pending_review") bucket.pendingAmount += r.sumAmount;
      byMethodMap.set(method, bucket);
    }

    const byMethod: PaymentClosingSummary["byMethod"] = [
      ...byMethodMap.entries(),
    ]
      .map(([method, b]) => ({
        method,
        count: b.count,
        approvedAmount: this.round2(b.approvedAmount),
        pendingAmount: this.round2(b.pendingAmount),
      }))
      .sort((a, b) => b.count - a.count);

    return {
      periodLabel,
      totalCount,
      approvedCount,
      rejectedCount,
      pendingCount,
      byMethod,
    };
  }

  /**
   * Resuelve el rango. Distinto del de analytics: por defecto **HOY**
   * (el caso de "cerrar caja" más típico es el día de hoy).
   */
  private resolvePeriod(query: PaymentTransactionsQueryDto): {
    from: Date;
    to: Date;
    periodLabel: string;
  } {
    const today = new Date().toISOString().slice(0, 10);
    const fromStr = query.dateFrom ?? today;
    const toStr = query.dateTo ?? today;

    const from = new Date(`${fromStr}T00:00:00.000Z`);
    const to = new Date(`${toStr}T23:59:59.999Z`);
    if (isNaN(from.getTime())) {
      throw new BadRequestException("dateFrom inválido");
    }
    if (isNaN(to.getTime())) {
      throw new BadRequestException("dateTo inválido");
    }
    if (from > to) {
      throw new BadRequestException("dateFrom no puede ser posterior a dateTo");
    }

    const periodLabel = `${fromStr} → ${toStr}`;
    return { from, to, periodLabel };
  }

  private toListItem(
    d: PaymentTransactionDocument,
  ): PaymentTransactionListItem {
    const ts = d as unknown as { createdAt: Date };
    return {
      _id: String(d._id),
      orderId: String(d.orderId),
      traceId: d.traceId,
      method: d.method as PaymentTransactionMethod,
      status: d.status as PaymentTransactionStatus,
      amount: d.amount,
      reference: d.reference ?? null,
      senderPhone: d.senderPhone ?? null,
      senderBank: d.senderBank ?? null,
      beneficiaryPhone: d.beneficiaryPhone ?? null,
      beneficiaryBank: d.beneficiaryBank ?? null,
      crossCheckStatus: (d.crossCheckStatus ?? "unknown") as PaymentCrossCheck,
      reviewedBy: d.reviewedBy ?? null,
      reviewedAt: d.reviewedAt ? new Date(d.reviewedAt).toISOString() : null,
      rejectionReason: d.rejectionReason ?? null,
      receipt_url: d.receipt_url ?? null,
      createdAt: ts.createdAt.toISOString(),
    };
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /** RFC 4180: comillas si hay coma, comilla, salto de línea o retorno. */
  private csvEscape = (value: string): string => {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  // ── Arqueo de caja ─────────────────────────────────────────────────────

  async saveArqueo(
    tenantId: string,
    dto: SaveArqueoDto,
    cerrado_por: string,
  ): Promise<CajaArqueoType> {
    const doc = (await this.arqueoModel.findOneAndUpdate(
      { tenantId: new Types.ObjectId(tenantId), date: dto.date },
      {
        $set: {
          efectivo_fisico: dto.efectivo_fisico ?? null,
          debito_fisico: dto.debito_fisico ?? null,
          debito_receipt_url: dto.debito_receipt_url ?? null,
          debito_receipt_public_id: dto.debito_receipt_public_id ?? null,
          notas: dto.notas ?? null,
          cerrado_por,
        },
      },
      { upsert: true, new: true, lean: true },
    )) as unknown as CajaArqueoDocument;
    return this.mapArqueo(doc);
  }

  async getArqueo(
    tenantId: string,
    date: string,
  ): Promise<CajaArqueoType | null> {
    const doc = (await this.arqueoModel
      .findOne({ tenantId: new Types.ObjectId(tenantId), date })
      .lean()
      .exec()) as unknown as CajaArqueoDocument | null;
    return doc ? this.mapArqueo(doc) : null;
  }

  /**
   * Cierra formalmente el arqueo del día. Upsert: crea el documento si no
   * existe (cierre sin arqueo previo) y setea `is_closed = true` + `closed_at`.
   * Si ya estaba cerrado devuelve el doc tal cual (idempotente).
   */
  async closeArqueo(
    tenantId: string,
    date: string,
    closedBy: string,
  ): Promise<CajaArqueoType> {
    const doc = (await this.arqueoModel.findOneAndUpdate(
      { tenantId: new Types.ObjectId(tenantId), date },
      {
        $set: {
          is_closed: true,
          closed_at: new Date(),
          cerrado_por: closedBy,
        },
        // Solo setea cerrado_por en el upsert inicial (si no existe doc previo)
        $setOnInsert: {
          efectivo_fisico: null,
          debito_fisico: null,
          debito_receipt_url: null,
          debito_receipt_public_id: null,
          notas: null,
        },
      },
      { upsert: true, new: true, lean: true },
    )) as unknown as CajaArqueoDocument;
    return this.mapArqueo(doc);
  }

  private mapArqueo(doc: any): CajaArqueoType {
    return {
      _id: (doc._id as Types.ObjectId).toString(),
      date: doc.date as string,
      efectivo_fisico: doc.efectivo_fisico ?? null,
      debito_fisico: doc.debito_fisico ?? null,
      debito_receipt_url: doc.debito_receipt_url ?? null,
      debito_receipt_public_id: doc.debito_receipt_public_id ?? null,
      notas: doc.notas ?? null,
      cerrado_por: doc.cerrado_por as string,
      is_closed: doc.is_closed ?? false,
      closed_at: doc.closed_at ? (doc.closed_at as Date).toISOString() : null,
      createdAt: (doc.createdAt as Date)?.toISOString?.() ?? "",
      updatedAt: (doc.updatedAt as Date)?.toISOString?.() ?? "",
    };
  }
}
