import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  PaymentLink,
  PaymentLinkDocument,
} from "./schemas/payment-link.schema";
import {
  CreatePaymentLinkDto,
  MarkPaidDto,
  SubmitPaymentLinkPagomovilDto,
  SubmitTransferDto,
  SubmitZelleDto,
} from "./dto/payment-link.dto";
import { AppLogger } from "../logger/logger.service";
import { TenantService } from "../tenant/tenant.service";
import { MediaService } from "../media/media.service";
import { AuthUser } from "@foodorder/types";

@Injectable()
export class PaymentLinkService {
  constructor(
    @InjectModel(PaymentLink.name) private model: Model<PaymentLinkDocument>,
    private tenantService: TenantService,
    private mediaService: MediaService,
    private logger: AppLogger,
  ) {}

  async create(
    tenantId: string,
    user: AuthUser,
    dto: CreatePaymentLinkDto,
    traceId?: string,
  ): Promise<PaymentLinkDocument> {
    const tenant = await this.tenantService.findById(tenantId);
    const method = dto.paymentMethod ?? "pagomovil";

    // Resolver el snapshot de la cuenta seleccionada
    let paymentAccountSnapshot: Record<string, unknown> | null = null;
    const accountId = dto.paymentAccountId ?? null;
    if (accountId) {
      if (method === "pagomovil") {
        const acc = (tenant.bankAccounts ?? []).find(
          (a) => String(a._id) === accountId,
        );
        if (acc)
          paymentAccountSnapshot = { ...acc } as unknown as Record<
            string,
            unknown
          >;
      } else if (method === "transfer") {
        const acc = ((tenant as any).transferAccounts ?? []).find(
          (a: any) => String(a._id) === accountId,
        );
        if (acc) paymentAccountSnapshot = { ...acc };
      } else if (method === "zelle") {
        const acc = ((tenant as any).zelleAccounts ?? []).find(
          (a: any) => String(a._id) === accountId,
        );
        if (acc) paymentAccountSnapshot = { ...acc };
      }
    } else {
      // Si no se especifica cuenta, usar la default del método
      if (method === "pagomovil") {
        const acc =
          (tenant.bankAccounts ?? []).find((a) => a.isDefault && a.isActive) ??
          (tenant.bankAccounts ?? []).find((a) => a.isActive);
        if (acc)
          paymentAccountSnapshot = { ...acc } as unknown as Record<
            string,
            unknown
          >;
      } else if (method === "transfer") {
        const acc =
          ((tenant as any).transferAccounts ?? []).find(
            (a: any) => a.isDefault && a.isActive,
          ) ??
          ((tenant as any).transferAccounts ?? []).find((a: any) => a.isActive);
        if (acc) paymentAccountSnapshot = { ...acc };
      } else if (method === "zelle") {
        const acc =
          ((tenant as any).zelleAccounts ?? []).find(
            (a: any) => a.isDefault && a.isActive,
          ) ??
          ((tenant as any).zelleAccounts ?? []).find((a: any) => a.isActive);
        if (acc) paymentAccountSnapshot = { ...acc };
      }
    }

    const link = await this.model.create({
      tenantId: tenant._id,
      tenantSlug: tenant.slug,
      createdBy: new Types.ObjectId(user._id),
      description: dto.description,
      amount: dto.amount,
      customerName: dto.customerName ?? null,
      internalNote: dto.internalNote ?? null,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
      paymentMethod: method,
      paymentAccountId:
        accountId ??
        (paymentAccountSnapshot
          ? String((paymentAccountSnapshot as any)._id)
          : null),
      paymentAccountSnapshot,
    });
    this.logger.log(
      `PaymentLink creado: ${String(link._id)} — $${dto.amount} — "${dto.description}"`,
      "PaymentLinkService",
      traceId,
    );
    return link;
  }

  async listByTenant(
    tenantId: string,
    status?: string,
  ): Promise<PaymentLinkDocument[]> {
    const filter: Record<string, unknown> = {
      tenantId: new Types.ObjectId(tenantId),
    };
    if (status) filter.status = status;
    return this.model
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()
      .exec() as unknown as PaymentLinkDocument[];
  }

  async getPublic(linkId: string): Promise<PaymentLinkDocument> {
    if (!Types.ObjectId.isValid(linkId))
      throw new NotFoundException("Link no encontrado");
    const link = (await this.model
      .findById(linkId)
      .lean()
      .exec()) as unknown as PaymentLinkDocument;
    if (!link) throw new NotFoundException("Link no encontrado");
    if (link.expiresAt && new Date() > new Date(link.expiresAt)) {
      if ((link as any).status === "active") {
        await this.model.findByIdAndUpdate(linkId, { status: "expired" });
        (link as any).status = "expired";
      }
    }
    return link;
  }

  async cancel(linkId: string, tenantId: string): Promise<PaymentLinkDocument> {
    const link = await this.model.findById(linkId).exec();
    if (!link) throw new NotFoundException("Link no encontrado");
    if (String(link.tenantId) !== String(tenantId))
      throw new ForbiddenException();
    if (link.status === "paid")
      throw new BadRequestException("No se puede cancelar un link ya pagado");
    link.status = "cancelled";
    return link.save() as unknown as PaymentLinkDocument;
  }

  async markPaid(
    linkId: string,
    tenantId: string,
    dto: MarkPaidDto,
    traceId?: string,
  ): Promise<PaymentLinkDocument> {
    const link = await this.model.findById(linkId).exec();
    if (!link) throw new NotFoundException("Link no encontrado");
    if (String(link.tenantId) !== String(tenantId))
      throw new ForbiddenException();
    // Aceptamos active y pending_verification (admin puede confirmar tanto un
    // cobro fuera de banda como aprobar una transferencia PagoMóvil pendiente).
    if (!["active", "pending_verification"].includes(link.status)) {
      throw new BadRequestException(
        `Link en estado '${link.status}' — no se puede marcar como pagado`,
      );
    }
    link.status = "paid";
    link.paidAt = new Date();
    link.paidWith = dto.paidWith;
    link.paidTraceId = traceId ?? null;
    this.logger.log(
      `PaymentLink ${linkId} pagado con ${dto.paidWith}`,
      "PaymentLinkService",
      traceId,
    );
    return link.save() as unknown as PaymentLinkDocument;
  }

  // ── Cliente: pagomóvil submission desde la página pública ─────────────

  /**
   * Cliente sube comprobante PagoMóvil a Cloudinary y devuelve la URL.
   * No transiciona el estado del link — eso ocurre en `submitPagomovil` cuando
   * el cliente confirma con los demás datos (referencia, teléfono, etc.).
   */
  async attachReceipt(
    linkId: string,
    tenantSlug: string,
    buffer: Buffer,
    traceId?: string,
  ): Promise<{ url: string }> {
    const link = await this.model.findById(linkId).exec();
    if (!link) throw new NotFoundException("Link no encontrado");
    if (link.tenantSlug !== tenantSlug) throw new ForbiddenException();
    if (!["active", "pending_verification"].includes(link.status)) {
      throw new BadRequestException(
        `No se puede adjuntar comprobante en estado: ${link.status}`,
      );
    }

    const ts = Date.now();
    const { url, publicId } = await this.mediaService.uploadImage(buffer, {
      folder: `foodorder/${tenantSlug}/payment-link-receipts`,
      filename: `link${linkId}_${ts}`,
    });

    await this.model.findByIdAndUpdate(linkId, {
      $set: {
        pagomovil_receipt_url: url,
        pagomovil_receipt_public_id: publicId,
      },
    });

    this.logger.log(
      `PaymentLink comprobante subido: ${linkId} | public_id=${publicId}`,
      "PaymentLinkService",
      traceId,
    );

    return { url };
  }

  /**
   * Cliente confirma el pago: setea los campos PagoMóvil y transiciona
   * `active → pending_verification`. El admin debe revisar y aprobar/rechazar.
   */
  async submitPagomovil(
    linkId: string,
    tenantSlug: string,
    dto: SubmitPaymentLinkPagomovilDto,
    traceId?: string,
  ): Promise<PaymentLinkDocument> {
    const link = await this.model.findById(linkId).exec();
    if (!link) throw new NotFoundException("Link no encontrado");
    if (link.tenantSlug !== tenantSlug) throw new ForbiddenException();
    if (link.status !== "active") {
      throw new BadRequestException(
        `No se puede confirmar pago en estado: ${link.status}`,
      );
    }

    link.status = "pending_verification";
    link.pagomovil_reference = dto.pagomovil_reference;
    link.pagomovil_phone = dto.pagomovil_phone;
    link.pagomovil_bank = dto.pagomovil_bank ?? null;
    link.pagomovil_amount_bs = dto.pagomovil_amount_bs;
    link.pagomovil_receipt_url = dto.pagomovil_receipt_url;
    link.pagomovil_submitted_at = new Date();
    link.pagomovil_beneficiary_phone = dto.pagomovil_beneficiary_phone ?? null;
    link.pagomovil_beneficiary_bank = dto.pagomovil_beneficiary_bank ?? null;
    link.pagomovil_crosscheck = dto.pagomovil_crosscheck ?? null;
    link.pagomovil_date = dto.pagomovil_date ?? null;

    this.logger.log(
      `PaymentLink pagomovil enviado: ${linkId} ref=${dto.pagomovil_reference} amount_bs=${dto.pagomovil_amount_bs}`,
      "PaymentLinkService",
      traceId,
    );

    return link.save() as unknown as PaymentLinkDocument;
  }

  async submitTransfer(
    linkId: string,
    tenantSlug: string,
    dto: SubmitTransferDto,
    traceId?: string,
  ): Promise<PaymentLinkDocument> {
    const link = await this.model.findById(linkId).exec();
    if (!link) throw new NotFoundException("Link no encontrado");
    if (link.tenantSlug !== tenantSlug) throw new ForbiddenException();
    if (link.status !== "active") {
      throw new BadRequestException(
        `No se puede confirmar pago en estado: ${link.status}`,
      );
    }

    link.status = "pending_verification";
    link.transfer_receipt_url = dto.receipt_url;
    link.transfer_reference = dto.transfer_reference ?? null;
    link.transfer_amount = dto.transfer_amount ?? null;
    link.transfer_currency = dto.transfer_currency ?? null;
    link.transfer_sender_name = dto.transfer_sender_name ?? null;
    link.transfer_date = dto.transfer_date ?? null;
    link.transfer_submitted_at = new Date();
    link.transfer_crosscheck = dto.transfer_crosscheck ?? null;

    this.logger.log(
      `PaymentLink transfer enviado: ${linkId} ref=${dto.transfer_reference}`,
      "PaymentLinkService",
      traceId,
    );

    return link.save() as unknown as PaymentLinkDocument;
  }

  async submitZelle(
    linkId: string,
    tenantSlug: string,
    dto: SubmitZelleDto,
    traceId?: string,
  ): Promise<PaymentLinkDocument> {
    const link = await this.model.findById(linkId).exec();
    if (!link) throw new NotFoundException("Link no encontrado");
    if (link.tenantSlug !== tenantSlug) throw new ForbiddenException();
    if (link.status !== "active") {
      throw new BadRequestException(
        `No se puede confirmar pago en estado: ${link.status}`,
      );
    }

    link.status = "pending_verification";
    link.zelle_receipt_url = dto.receipt_url;
    link.zelle_amount = dto.zelle_amount ?? null;
    link.zelle_reference = dto.zelle_reference ?? null;
    link.zelle_sender_name = dto.zelle_sender_name ?? null;
    link.zelle_sender_email = dto.zelle_sender_email ?? null;
    link.zelle_date = dto.zelle_date ?? null;
    link.zelle_submitted_at = new Date();
    link.zelle_crosscheck = dto.zelle_crosscheck ?? null;

    this.logger.log(
      `PaymentLink zelle enviado: ${linkId} amount=${dto.zelle_amount}`,
      "PaymentLinkService",
      traceId,
    );

    return link.save() as unknown as PaymentLinkDocument;
  }
}
