import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { QrPage, QrPageDocument } from "./schemas/qr-page.schema";
import {
  CreateQrPageDto,
  UpdateQrPageDto,
  CreatePaymentFromQrDto,
} from "./dto/qr-page.dto";
import { AppLogger } from "../logger/logger.service";
import { TenantService } from "../tenant/tenant.service";
import { MenuService } from "../menu/menu.service";
import { PaymentLinkService } from "../payment-link/payment-link.service";
import { PaymentLinkDocument } from "../payment-link/schemas/payment-link.schema";
import type { AuthUser } from "@bia/types";

@Injectable()
export class QrPageService {
  constructor(
    @InjectModel(QrPage.name) private model: Model<QrPageDocument>,
    private readonly tenantService: TenantService,
    private readonly menuService: MenuService,
    private readonly paymentLinkService: PaymentLinkService,
    private readonly logger: AppLogger,
  ) {}

  // ── Admin CRUD ─────────────────────────────────────────────────────────────

  async create(
    tenantId: string,
    user: AuthUser,
    dto: CreateQrPageDto,
  ): Promise<QrPageDocument> {
    const tenant = await this.tenantService.findById(tenantId);

    // Validar que amount esté presente si type = fixed_amount
    if (dto.type === "fixed_amount" && !dto.amount) {
      throw new BadRequestException(
        "El campo amount es requerido cuando type es fixed_amount.",
      );
    }

    // shortCode único por tenant
    const existing = await this.model
      .findOne({
        tenantId: new Types.ObjectId(tenantId),
        shortCode: dto.shortCode,
      })
      .lean()
      .exec();

    if (existing) {
      throw new ConflictException(
        `El código "${dto.shortCode}" ya está en uso para tu negocio. Elegí uno diferente.`,
      );
    }

    const page = await this.model.create({
      tenantId: new Types.ObjectId(tenantId),
      tenantSlug: tenant.slug,
      createdBy: new Types.ObjectId(user._id),
      shortCode: dto.shortCode,
      title: dto.title,
      description: dto.description ?? null,
      type: dto.type,
      amount: dto.type === "fixed_amount" ? (dto.amount ?? null) : null,
      productIds: dto.productIds ?? [],
      allowQuantity: dto.allowQuantity ?? true,
      paymentMethods: dto.paymentMethods,
      defaultPaymentMethod: dto.defaultPaymentMethod,
      paymentAccountId: dto.paymentAccountId ?? null,
      isActive: dto.isActive ?? true,
    });

    this.logger.log(
      `QrPage creada: ${String(page._id)} — shortCode="${dto.shortCode}" tipo="${dto.type}"`,
      "QrPageService",
    );

    return page;
  }

  async list(tenantId: string): Promise<QrPageDocument[]> {
    return this.model
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean()
      .exec() as unknown as QrPageDocument[];
  }

  async findOne(tenantId: string, id: string): Promise<QrPageDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException("Página QR no encontrada");
    }
    const page = (await this.model
      .findById(id)
      .lean()
      .exec()) as unknown as QrPageDocument | null;
    if (!page) throw new NotFoundException("Página QR no encontrada");
    if (String(page.tenantId) !== String(tenantId))
      throw new ForbiddenException();
    return page;
  }

  async update(
    tenantId: string,
    id: string,
    dto: UpdateQrPageDto,
  ): Promise<QrPageDocument> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException("Página QR no encontrada");
    }
    const page = await this.model.findById(id).exec();
    if (!page) throw new NotFoundException("Página QR no encontrada");
    if (String(page.tenantId) !== String(tenantId))
      throw new ForbiddenException();

    // Aplicar solo los campos enviados (shortCode siempre ignorado en updates)
    if (dto.title !== undefined) page.title = dto.title;
    if (dto.description !== undefined)
      page.description = dto.description ?? null;
    if (dto.type !== undefined) page.type = dto.type;
    if (dto.amount !== undefined) page.amount = dto.amount ?? null;
    if (dto.productIds !== undefined) page.productIds = dto.productIds;
    if (dto.allowQuantity !== undefined) page.allowQuantity = dto.allowQuantity;
    if (dto.paymentMethods !== undefined)
      page.paymentMethods = dto.paymentMethods;
    if (dto.defaultPaymentMethod !== undefined)
      page.defaultPaymentMethod = dto.defaultPaymentMethod;
    if (dto.paymentAccountId !== undefined)
      page.paymentAccountId = dto.paymentAccountId ?? null;
    if (dto.isActive !== undefined) page.isActive = dto.isActive;

    // Si cambió el tipo a no-fixed_amount, limpiar amount
    if (dto.type && dto.type !== "fixed_amount") {
      page.amount = null;
    }

    const updated = await page.save();
    this.logger.log(`QrPage actualizada: ${id}`, "QrPageService");
    return updated as unknown as QrPageDocument;
  }

  async remove(tenantId: string, id: string): Promise<void> {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException("Página QR no encontrada");
    }
    const page = await this.model.findById(id).exec();
    if (!page) throw new NotFoundException("Página QR no encontrada");
    if (String(page.tenantId) !== String(tenantId))
      throw new ForbiddenException();
    await this.model.deleteOne({ _id: page._id });
    this.logger.log(`QrPage eliminada: ${id}`, "QrPageService");
  }

  // ── Público ────────────────────────────────────────────────────────────────

  /**
   * Devuelve la configuración pública de una QrPage.
   * Si isActive=false, devuelve { isActive: false } con HTTP 200 para que el
   * frontend muestre "no disponible" en lugar de un error genérico 404.
   */
  async getPublicConfig(
    tenantSlug: string,
    shortCode: string,
  ): Promise<{
    isActive: boolean;
    qrPage?: {
      _id: string;
      title: string;
      description: string | null;
      type: string;
      amount: number | null;
      allowQuantity: boolean;
      paymentMethods: string[];
      defaultPaymentMethod: string;
    };
    products?: unknown[];
    bankAccountSnapshot?: Record<string, unknown> | null;
  }> {
    const page = (await this.model
      .findOne({ tenantSlug, shortCode })
      .lean()
      .exec()) as unknown as QrPageDocument | null;

    if (!page)
      throw new NotFoundException(`Página QR "${shortCode}" no encontrada`);

    const tenant = await this.tenantService.findById(String(page.tenantId));

    // Si el módulo está desactivado para el tenant, tratar como no disponible
    if ((tenant as any).modules?.qr_pages === false) {
      return { isActive: false };
    }

    if (!page.isActive) {
      return { isActive: false };
    }

    // Resolver productos si aplica
    let products: unknown[] | undefined;
    if (page.type === "product_selection") {
      if (page.productIds.length > 0) {
        const map = await this.menuService.findManyByIdsForTenant(
          page.productIds,
          String(page.tenantId),
        );
        products = Array.from(map.values()).map((p) => ({
          _id: String(p._id),
          name: (p as any).name,
          price: (p as any).price,
          image_url: (p as any).image_url ?? null,
          category: (p as any).category ?? null,
        }));
      } else {
        // productIds vacío = todos los activos del tenant
        const all = await this.menuService.getAllForAdmin(
          String(page.tenantId),
        );
        products = all
          .filter((p) => (p as any).active)
          .map((p) => ({
            _id: String(p._id),
            name: (p as any).name,
            price: (p as any).price,
            image_url: (p as any).image_url ?? null,
            category: (p as any).category ?? null,
          }));
      }
    }

    // Resolver snapshot de cuenta bancaria
    const bankAccountSnapshot = this.resolveBankAccountSnapshot(tenant, page);

    return {
      isActive: true,
      qrPage: {
        _id: String(page._id),
        title: page.title,
        description: page.description,
        type: page.type,
        amount: page.amount,
        allowQuantity: page.allowQuantity,
        paymentMethods: page.paymentMethods,
        defaultPaymentMethod: page.defaultPaymentMethod,
      },
      products,
      bankAccountSnapshot,
    };
  }

  /**
   * El cliente confirma el pago: crea un PaymentLink normal con el monto
   * calculado server-side y devuelve su _id para que el frontend redirija
   * a la página de pago existente (/:slug/pago/:linkId).
   */
  async createPaymentFromQr(
    tenantSlug: string,
    shortCode: string,
    dto: CreatePaymentFromQrDto,
  ): Promise<PaymentLinkDocument> {
    const page = (await this.model
      .findOne({ tenantSlug, shortCode })
      .lean()
      .exec()) as unknown as QrPageDocument | null;

    if (!page)
      throw new NotFoundException(`Página QR "${shortCode}" no encontrada`);

    const tenantId = String(page.tenantId);

    // Verificar que el módulo qr_pages esté habilitado para el tenant
    const tenantForCheck = await this.tenantService.findById(tenantId);
    if ((tenantForCheck as any).modules?.qr_pages === false) {
      throw new BadRequestException(
        "Esta página de cobro no está disponible en este momento.",
      );
    }

    if (!page.isActive) {
      throw new BadRequestException(
        "Esta página de cobro no está disponible en este momento.",
      );
    }

    // Calcular amount server-side según el tipo
    let amount: number;
    let descriptionExtra = "";

    if (page.type === "fixed_amount") {
      if (!page.amount || page.amount <= 0) {
        throw new BadRequestException(
          "Esta página de cobro no tiene un monto configurado.",
        );
      }
      amount = page.amount;
    } else if (page.type === "product_selection") {
      const items = dto.items ?? [];
      if (!items.length) {
        throw new BadRequestException(
          "Seleccioná al menos un producto para continuar.",
        );
      }

      const productIds = items.map((i) => i.productId);
      const productMap = await this.menuService.findManyByIdsForTenant(
        productIds,
        tenantId,
      );

      // Verificar que todos los productos existen y pertenecen al tenant (anti-manipulación)
      const missing = productIds.filter((id) => !productMap.has(id));
      if (missing.length) {
        throw new BadRequestException(
          `Algunos productos no están disponibles: ${missing.join(", ")}`,
        );
      }

      // Calcular total con precios del servidor (NUNCA del cliente)
      amount = items.reduce((sum, item) => {
        const product = productMap.get(item.productId)!;
        return sum + (product as any).price * item.quantity;
      }, 0);
      amount = Math.round(amount * 100) / 100;

      if (amount <= 0) {
        throw new BadRequestException(
          "El total del pedido debe ser mayor a $0.",
        );
      }

      // Construir resumen de productos para el description
      const productNames = items.map((item) => {
        const p = productMap.get(item.productId)!;
        return `${(p as any).name} ×${item.quantity}`;
      });
      descriptionExtra = ` — ${productNames.join(", ")}`;
    } else {
      // open_amount
      if (!dto.amount || dto.amount <= 0) {
        throw new BadRequestException(
          "El monto ingresado debe ser mayor a $0.",
        );
      }
      amount = dto.amount;
    }

    // Resolver snapshot de cuenta bancaria para el PaymentLink (reutiliza tenantForCheck)
    const bankAccountSnapshot = this.resolveBankAccountSnapshot(
      tenantForCheck,
      page,
    );

    // El authUser del PaymentLink es el admin que creó la QrPage (como "propietario" del link)
    const systemUser: AuthUser = {
      _id: String(page.createdBy),
      email: "qr-system@internal",
      role: "admin",
      tenantId,
    };

    const paymentLink = await this.paymentLinkService.create(
      tenantId,
      systemUser,
      {
        description: `${page.title}${descriptionExtra}`,
        amount,
        paymentMethod: dto.paymentMethod as "pagomovil" | "transfer" | "zelle",
        customerName: dto.customerName,
        paymentAccountId: page.paymentAccountId ?? undefined,
      },
    );

    this.logger.log(
      `QrPage "${shortCode}" generó PaymentLink ${String((paymentLink as any)._id)} — $${amount}`,
      "QrPageService",
    );

    return paymentLink;
  }

  // ── Helpers privados ───────────────────────────────────────────────────────

  private resolveBankAccountSnapshot(
    tenant: any,
    page: QrPageDocument,
  ): Record<string, unknown> | null {
    const method = page.defaultPaymentMethod;
    const accountId = page.paymentAccountId;

    if (method === "pagomovil") {
      const accounts: any[] = tenant.bankAccounts ?? [];
      const acc = accountId
        ? accounts.find((a) => String(a._id) === accountId)
        : (accounts.find((a) => a.isDefault && a.isActive) ??
          accounts.find((a) => a.isActive));
      return acc ? { ...acc } : null;
    }

    if (method === "transfer") {
      const accounts: any[] = (tenant as any).transferAccounts ?? [];
      const acc = accountId
        ? accounts.find((a) => String(a._id) === accountId)
        : (accounts.find((a) => a.isDefault && a.isActive) ??
          accounts.find((a) => a.isActive));
      return acc ? { ...acc } : null;
    }

    if (method === "zelle") {
      const accounts: any[] = (tenant as any).zelleAccounts ?? [];
      const acc = accountId
        ? accounts.find((a) => String(a._id) === accountId)
        : (accounts.find((a) => a.isDefault && a.isActive) ??
          accounts.find((a) => a.isActive));
      return acc ? { ...acc } : null;
    }

    return null;
  }
}
