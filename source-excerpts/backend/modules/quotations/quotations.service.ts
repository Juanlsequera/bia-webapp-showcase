import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { AppLogger } from "../logger/logger.service";
import { EmailService } from "../auth/email.service";
import { Quotation, QuotationDocument } from "./schemas/quotation.schema";
import { CreateQuotationDto, UpdateQuotationDto } from "./dto/quotation.dto";

export interface QuotationListQuery {
  status?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

@Injectable()
export class QuotationsService {
  constructor(
    @InjectModel(Quotation.name)
    private readonly model: Model<QuotationDocument>,
    private readonly logger: AppLogger,
    private readonly emailService: EmailService,
  ) {}

  async create(
    tenantId: string,
    dto: CreateQuotationDto,
    createdBy: string,
  ): Promise<QuotationDocument> {
    const number = await this.generateNumber(tenantId);
    const laborLines = dto.laborLines ?? [];
    const { materialsSubtotal, laborSubtotal, subtotal, ivaAmount, total } =
      this.calcTotals(dto.items, laborLines, dto.ivaEnabled, dto.ivaRate ?? 16);

    const doc = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      number,
      status: "draft",
      clientName: dto.clientName.trim(),
      clientCompany: dto.clientCompany?.trim() ?? "",
      clientEmail: dto.clientEmail?.trim() ?? "",
      clientPhone: dto.clientPhone?.trim() ?? "",
      clientRif: dto.clientRif?.trim() ?? "",
      title: dto.title?.trim() ?? "",
      date: new Date(dto.date),
      validUntil: new Date(dto.validUntil),
      currency: dto.currency ?? "USD",
      items: dto.items.map((i) => ({ ...i, unit: i.unit ?? "unidad" })),
      laborLines,
      ivaEnabled: dto.ivaEnabled,
      ivaRate: dto.ivaRate ?? 16,
      materialsSubtotal,
      laborSubtotal,
      subtotal,
      ivaAmount,
      total,
      notes: dto.notes?.trim() ?? "",
      internalNotes: dto.internalNotes?.trim() ?? "",
      createdBy,
    });

    this.logger.log(
      `Quotation creada: ${String(doc._id)} | ${number} | $${total}`,
      "QuotationsService",
    );
    return doc;
  }

  async list(
    tenantId: string,
    query: QuotationListQuery,
  ): Promise<{
    docs: QuotationDocument[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const skip = (page - 1) * limit;

    const filter: Record<string, unknown> = {
      tenantId: new Types.ObjectId(tenantId),
    };
    if (query.status) filter["status"] = query.status;
    if (query.dateFrom || query.dateTo) {
      const df: Record<string, Date> = {};
      if (query.dateFrom) df["$gte"] = new Date(query.dateFrom);
      if (query.dateTo) {
        const to = new Date(query.dateTo);
        to.setHours(23, 59, 59, 999);
        df["$lte"] = to;
      }
      filter["date"] = df;
    }

    const [docs, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ date: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { docs: docs as unknown as QuotationDocument[], total, page, limit };
  }

  async findOne(tenantId: string, id: string): Promise<QuotationDocument> {
    this.assertId(id);
    const doc = await this.model
      .findOne({
        _id: new Types.ObjectId(id),
        tenantId: new Types.ObjectId(tenantId),
      })
      .lean()
      .exec();
    if (!doc) throw new NotFoundException(`Cotización ${id} no encontrada`);
    return doc as unknown as QuotationDocument;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateQuotationDto,
  ): Promise<QuotationDocument> {
    this.assertId(id);

    const existing = await this.findOne(tenantId, id);
    const items = dto.items ?? (existing.items as unknown as typeof dto.items);
    const laborLines =
      dto.laborLines ??
      (existing.laborLines as unknown as typeof dto.laborLines) ??
      [];
    const ivaEnabled = dto.ivaEnabled ?? existing.ivaEnabled;
    const ivaRate = dto.ivaRate ?? existing.ivaRate;

    const { materialsSubtotal, laborSubtotal, subtotal, ivaAmount, total } =
      this.calcTotals(items ?? [], laborLines, ivaEnabled, ivaRate);

    const update: Record<string, unknown> = {
      materialsSubtotal,
      laborSubtotal,
      subtotal,
      ivaAmount,
      total,
    };
    if (dto.clientName !== undefined)
      update["clientName"] = dto.clientName.trim();
    if (dto.clientCompany !== undefined)
      update["clientCompany"] = dto.clientCompany.trim();
    if (dto.clientEmail !== undefined)
      update["clientEmail"] = dto.clientEmail.trim();
    if (dto.clientPhone !== undefined)
      update["clientPhone"] = dto.clientPhone.trim();
    if (dto.clientRif !== undefined) update["clientRif"] = dto.clientRif.trim();
    if (dto.title !== undefined) update["title"] = dto.title.trim();
    if (dto.date !== undefined) update["date"] = new Date(dto.date);
    if (dto.validUntil !== undefined)
      update["validUntil"] = new Date(dto.validUntil);
    if (dto.items !== undefined)
      update["items"] = dto.items.map((i) => ({
        ...i,
        unit: i.unit ?? "unidad",
      }));
    if (dto.laborLines !== undefined) update["laborLines"] = dto.laborLines;
    if (dto.ivaEnabled !== undefined) update["ivaEnabled"] = dto.ivaEnabled;
    if (dto.ivaRate !== undefined) update["ivaRate"] = dto.ivaRate;
    if (dto.notes !== undefined) update["notes"] = dto.notes.trim();
    if (dto.internalNotes !== undefined)
      update["internalNotes"] = dto.internalNotes.trim();

    const doc = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
        { $set: update },
        { new: true },
      )
      .lean()
      .exec();

    if (!doc) throw new NotFoundException(`Cotización ${id} no encontrada`);
    return doc as unknown as QuotationDocument;
  }

  async updateStatus(
    tenantId: string,
    id: string,
    status: "draft" | "sent" | "accepted" | "rejected" | "expired",
  ): Promise<QuotationDocument> {
    this.assertId(id);
    const doc = await this.model
      .findOneAndUpdate(
        { _id: new Types.ObjectId(id), tenantId: new Types.ObjectId(tenantId) },
        { $set: { status } },
        { new: true },
      )
      .lean()
      .exec();
    if (!doc) throw new NotFoundException(`Cotización ${id} no encontrada`);
    this.logger.log(`Quotation ${id} → ${status}`, "QuotationsService");

    if (status === "sent" && doc.clientEmail) {
      void this.sendQuotationEmail(doc as unknown as QuotationDocument);
    }

    return doc as unknown as QuotationDocument;
  }

  private async sendQuotationEmail(doc: QuotationDocument): Promise<void> {
    try {
      const fmtUsd = (n: number) =>
        new Intl.NumberFormat("en-US", {
          style: "currency",
          currency: "USD",
        }).format(n);

      const fmtDate = (d: Date | string) =>
        new Date(d).toLocaleDateString("es-VE", {
          day: "2-digit",
          month: "long",
          year: "numeric",
        });

      const itemRows = (doc.items ?? [])
        .map(
          (i) =>
            `<tr>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;">${i.description}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;">${i.quantity} ${i.unit}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;">${fmtUsd(i.unitPrice)}</td>
          <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:600;">${fmtUsd(i.subtotal)}</td>
        </tr>`,
        )
        .join("");

      const laborDoc = doc as unknown as {
        laborLines?: {
          description: string;
          hours: number;
          ratePerHour: number;
          fixedPrice: number;
          subtotal: number;
        }[];
        laborSubtotal?: number;
        materialsSubtotal?: number;
      };
      const laborLines = laborDoc.laborLines ?? [];

      const laborSection =
        laborLines.length > 0
          ? `<tr><td colspan="4" style="padding:10px 12px 4px;font-weight:600;font-size:13px;color:#4F46E5;border-top:2px solid #e0e7ff;">Mano de obra</td></tr>
          ${laborLines
            .map((l) => {
              const detail =
                l.hours > 0 && l.ratePerHour > 0
                  ? `${l.hours}h × ${fmtUsd(l.ratePerHour)}/h`
                  : "Precio fijo";
              return `<tr>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;">${l.description}</td>
              <td colspan="2" style="padding:8px 12px;border-bottom:1px solid #eee;text-align:center;color:#777;font-size:12px;">${detail}</td>
              <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-family:monospace;font-weight:600;">${fmtUsd(l.subtotal)}</td>
            </tr>`;
            })
            .join("")}`
          : "";

      const subtotalRowsMaterials =
        laborLines.length > 0
          ? `<tr><td colspan="3" style="padding:6px 12px;text-align:right;color:#555;font-size:13px;">Subtotal materiales</td>
           <td style="padding:6px 12px;text-align:right;font-family:monospace;">${fmtUsd(laborDoc.materialsSubtotal ?? doc.subtotal)}</td></tr>
           <tr><td colspan="3" style="padding:6px 12px;text-align:right;color:#555;font-size:13px;">Subtotal mano de obra</td>
           <td style="padding:6px 12px;text-align:right;font-family:monospace;">${fmtUsd(laborDoc.laborSubtotal ?? 0)}</td></tr>`
          : "";

      const ivaRow = doc.ivaEnabled
        ? `<tr><td colspan="3" style="padding:6px 12px;text-align:right;color:#555;">IVA (${doc.ivaRate}%)</td>
           <td style="padding:6px 12px;text-align:right;font-family:monospace;">${fmtUsd(doc.ivaAmount)}</td></tr>`
        : "";

      const html = `
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f8;font-family:system-ui,sans-serif;">
  <div style="max-width:600px;margin:32px auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
    <div style="background:#4F46E5;padding:24px 32px;">
      <p style="margin:0;font-size:22px;font-weight:700;color:white;">Cotización ${String(doc.number)}</p>
      <p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,.75);">Fecha: ${fmtDate(doc.date)} · Válida hasta: ${fmtDate(doc.validUntil)}</p>
    </div>
    <div style="padding:28px 32px;">
      <p style="margin:0 0 20px;font-size:15px;color:#333;">Hola <strong>${doc.clientName}</strong>,<br>
      te compartimos los detalles de tu cotización.</p>

      ${doc.title ? `<p style="font-size:14px;font-weight:600;color:#4F46E5;margin:0 0 16px;">${doc.title}</p>` : ""}

      <table style="width:100%;border-collapse:collapse;font-size:13px;">
        <thead>
          <tr style="background:#4F46E5;color:white;">
            <th style="padding:10px 12px;text-align:left;">Descripción</th>
            <th style="padding:10px 12px;text-align:center;">Cant.</th>
            <th style="padding:10px 12px;text-align:right;">P/U</th>
            <th style="padding:10px 12px;text-align:right;">Total</th>
          </tr>
        </thead>
        <tbody>${itemRows}${laborSection}</tbody>
        <tfoot>
          ${subtotalRowsMaterials}
          <tr><td colspan="3" style="padding:8px 12px;text-align:right;color:#555;font-size:13px;">Subtotal</td>
          <td style="padding:8px 12px;text-align:right;font-family:monospace;">${fmtUsd(doc.subtotal)}</td></tr>
          ${ivaRow}
          <tr style="background:#f0f0ff;">
            <td colspan="3" style="padding:10px 12px;text-align:right;font-weight:700;font-size:14px;">Total</td>
            <td style="padding:10px 12px;text-align:right;font-family:monospace;font-weight:800;font-size:16px;color:#4F46E5;">${fmtUsd(doc.total)}</td>
          </tr>
        </tfoot>
      </table>

      ${doc.notes ? `<div style="margin-top:20px;padding:14px;background:#f8f8ff;border-radius:8px;font-size:13px;color:#555;white-space:pre-wrap;">${doc.notes}</div>` : ""}

      <p style="margin-top:24px;font-size:12px;color:#aaa;text-align:center;">
        Cotización generada con <strong>Bia</strong> · Ref: ${String(doc.number)}
      </p>
    </div>
  </div>
</body>
</html>`;

      const text = [
        `Cotización ${String(doc.number)}`,
        `Fecha: ${fmtDate(doc.date)} — Válida hasta: ${fmtDate(doc.validUntil)}`,
        "",
        ...(doc.items ?? []).map(
          (i) =>
            `${i.description} × ${i.quantity} ${i.unit} = ${fmtUsd(i.subtotal)}`,
        ),
        ...(laborLines.length > 0
          ? [
              "",
              "Mano de obra:",
              ...laborLines.map(
                (l) => `${l.description} = ${fmtUsd(l.subtotal)}`,
              ),
            ]
          : []),
        "",
        ...(laborLines.length > 0
          ? [
              `Subtotal materiales: ${fmtUsd(laborDoc.materialsSubtotal ?? doc.subtotal)}`,
              `Subtotal mano de obra: ${fmtUsd(laborDoc.laborSubtotal ?? 0)}`,
            ]
          : []),
        `Subtotal: ${fmtUsd(doc.subtotal)}`,
        ...(doc.ivaEnabled
          ? [`IVA (${doc.ivaRate}%): ${fmtUsd(doc.ivaAmount)}`]
          : []),
        `Total: ${fmtUsd(doc.total)}`,
        ...(doc.notes ? ["", doc.notes] : []),
      ].join("\n");

      await this.emailService.send({
        to: doc.clientEmail,
        subject: `Cotización ${String(doc.number)} — ${fmtUsd(doc.total)}`,
        text,
        html,
      });

      this.logger.log(
        `Email cotización ${String(doc.number)} → ${doc.clientEmail}`,
        "QuotationsService",
      );
    } catch (err) {
      this.logger.log(
        `Error enviando email cotización: ${String(err)}`,
        "QuotationsService",
      );
    }
  }

  async remove(tenantId: string, id: string): Promise<void> {
    this.assertId(id);
    const result = await this.model
      .deleteOne({
        _id: new Types.ObjectId(id),
        tenantId: new Types.ObjectId(tenantId),
      })
      .exec();
    if (result.deletedCount === 0)
      throw new NotFoundException(`Cotización ${id} no encontrada`);
    this.logger.log(`Quotation ${id} eliminada`, "QuotationsService");
  }

  // ── helpers ─────────────────────────────────────────────────────────────────

  private async generateNumber(tenantId: string): Promise<string> {
    const year = new Date().getFullYear();
    const count = await this.model.countDocuments({
      tenantId: new Types.ObjectId(tenantId),
    });
    return `COT-${year}-${String(count + 1).padStart(3, "0")}`;
  }

  private calcTotals(
    items: { quantity: number; unitPrice: number; subtotal?: number }[],
    laborLines: {
      hours?: number;
      ratePerHour?: number;
      fixedPrice?: number;
      subtotal?: number;
    }[],
    ivaEnabled: boolean,
    ivaRate: number,
  ): {
    materialsSubtotal: number;
    laborSubtotal: number;
    subtotal: number;
    ivaAmount: number;
    total: number;
  } {
    const materialsSubtotal =
      Math.round(
        items.reduce(
          (acc, i) => acc + (i.subtotal ?? i.quantity * i.unitPrice),
          0,
        ) * 100,
      ) / 100;

    const laborSubtotal =
      Math.round(
        laborLines.reduce((acc, l) => {
          const lineTotal =
            l.subtotal ??
            ((l.hours ?? 0) * (l.ratePerHour ?? 0) || (l.fixedPrice ?? 0));
          return acc + lineTotal;
        }, 0) * 100,
      ) / 100;

    const subtotal =
      Math.round((materialsSubtotal + laborSubtotal) * 100) / 100;
    const ivaAmount = ivaEnabled
      ? Math.round(subtotal * (ivaRate / 100) * 100) / 100
      : 0;
    const total = Math.round((subtotal + ivaAmount) * 100) / 100;
    return { materialsSubtotal, laborSubtotal, subtotal, ivaAmount, total };
  }

  private assertId(id: string): void {
    if (!Types.ObjectId.isValid(id))
      throw new NotFoundException(`ID inválido: ${id}`);
  }
}
