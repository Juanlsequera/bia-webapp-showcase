import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  TenantPublic,
  CreateTenantResponse,
  BankAccount,
  TransferAccount,
  ZelleAccount,
  PLAN_MODULE_MAP,
  ARCHETYPE_MODULE_DEFAULTS,
  getPlanLimit,
  type BusinessType,
} from "@bia/types";
import { Tenant, TenantDocument } from "./schemas/tenant.schema";
import { User, UserDocument } from "../auth/schemas/user.schema";
import { CreateTenantDto } from "./dto/create-tenant.dto";
import { UpdateTenantDto } from "./dto/update-tenant.dto";
import { ConfigureTenantDto } from "./dto/configure-tenant.dto";
import {
  CreateBankAccountDto,
  UpdateBankAccountDto,
} from "./dto/bank-account.dto";
import {
  CreateTransferAccountDto,
  UpdateTransferAccountDto,
} from "./dto/transfer-account.dto";
import {
  CreateZelleAccountDto,
  UpdateZelleAccountDto,
} from "./dto/zelle-account.dto";
import { AuthService } from "../auth/auth.service";
import { AppLogger } from "../logger/logger.service";
import { BcvRateService } from "../bcv-rate/bcv-rate.service";

@Injectable()
export class TenantService {
  constructor(
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private authService: AuthService,
    private logger: AppLogger,
    private bcvRateService: BcvRateService,
  ) {}

  // ── Lookup básico usado por OrderService y otros ────────────────────
  async findBySlug(slug: string): Promise<TenantDocument> {
    try {
      const tenant = (await this.tenantModel
        .findOne({ slug: slug.toLowerCase(), active: true })
        .lean()
        .exec()) as unknown as TenantDocument | null;

      if (!tenant) {
        throw new NotFoundException(
          `Negocio "${slug}" no encontrado o inactivo`,
        );
      }
      return tenant;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.logError(error, "TenantService.findBySlug", { slug });
      throw error;
    }
  }

  async findById(tenantId: string): Promise<TenantDocument> {
    try {
      if (!Types.ObjectId.isValid(tenantId)) {
        throw new BadRequestException("tenantId invalido");
      }
      const tenant = (await this.tenantModel
        .findById(tenantId)
        .lean()
        .exec()) as unknown as TenantDocument | null;

      if (!tenant)
        throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
      return tenant;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      this.logger.logError(error, "TenantService.findById", { tenantId });
      throw error;
    }
  }

  // ── Horario de atención — calcula si el negocio está abierto ahora ──
  // Si no hay schedule configurado, siempre devuelve true (comportamiento legacy).
  // forceOpen y forceClosed son overrides del admin que tienen prioridad.
  computeIsOpen(schedule: TenantDocument["schedule"] | null): boolean {
    if (!schedule) return true; // sin horario = siempre abierto

    if (schedule.forceClosed) return false;
    if (schedule.forceOpen) return true;

    try {
      // BUG-06: Usar 'long' weekday para evitar la ambigüedad de 'narrow'
      // ('S' = Sunday/Saturday, 'T' = Tuesday/Thursday). Con 'long' cada nombre es único.
      const now = new Date();
      const tz = schedule.timezone ?? "America/Caracas";

      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hour: "numeric",
        hour12: false,
        weekday: "long",
      }).formatToParts(now);

      const hourPart = parts.find((p) => p.type === "hour");
      const weekdayPart = parts.find((p) => p.type === "weekday");
      const currentHour = hourPart ? Number(hourPart.value) : now.getHours();

      // Mapeo de weekday 'long' en-US → número 0-6 (sin ambigüedades)
      const DAY_MAP: Record<string, number> = {
        Sunday: 0,
        Monday: 1,
        Tuesday: 2,
        Wednesday: 3,
        Thursday: 4,
        Friday: 5,
        Saturday: 6,
      };
      const currentDay = DAY_MAP[weekdayPart?.value ?? ""] ?? now.getDay();

      // ¿Hoy es un día cerrado?
      if ((schedule.closedDays ?? []).includes(currentDay)) return false;

      // ¿Estamos dentro del horario?
      const { openHour, closeHour } = schedule;
      if (openHour <= closeHour) {
        // Horario normal: 8-22
        return currentHour >= openHour && currentHour < closeHour;
      } else {
        // Horario nocturno que cruza medianoche: 22-6
        return currentHour >= openHour || currentHour < closeHour;
      }
    } catch {
      // Si falla el cálculo de timezone (nombre inválido, etc.) dejamos pasar
      return true;
    }
  }

  // ── GET /:slug/public — cliente final sin auth ──────────────────────
  // Enriquecemos con la tasa BCV actual para que el frontend pueda mostrar
  // los precios en Bs sin tener que hacer un request extra. `getCurrent`
  // nunca tira — peor caso devuelve `stale: true` y el front muestra warning.
  async getPublicBySlug(slug: string): Promise<TenantPublic> {
    try {
      const tenant = await this.findBySlug(slug);
      const usdRate = await this.bcvRateService.getCurrent();
      const activeBankAccounts = (tenant.bankAccounts ?? [])
        .filter((a) => a.isActive)
        .map((a) => ({
          _id: String(a._id),
          bank: a.bank,
          phone: a.phone,
          rif: a.rif,
          accountHolder: a.accountHolder,
          isDefault: a.isDefault,
          isActive: a.isActive,
          qrImageUrl: a.qrImageUrl ?? null,
        })) as BankAccount[];
      const orderModes = (tenant as any).orderModes ?? {
        dine_in: true,
        takeaway: false,
        delivery: false,
      };
      return {
        slug: tenant.slug,
        name: tenant.name,
        archetype: (tenant as any).archetype ?? "food",
        logo_url: tenant.logo_url,
        cover_url: (tenant as any).cover_url ?? null,
        // nuevos campos multi-arquetipo (con fallback para tenants legacy)
        business_types: (tenant as any).business_types ?? ["food"],
        theme: (tenant as any).theme ?? {
          primary: "#E24B4A",
          secondary: "#374151",
          accent: "#6B7280",
          font_heading: "Inter",
          font_body: "Inter",
          border_radius: "default",
        },
        modules: (tenant as any).modules ?? {
          kitchen_kds: true,
          booking: false,
          product_variants: false,
          product_modifiers: true,
          inventory_tracking: false,
          delivery_zones: false,
          scheduled_orders: false,
          labor_pricing: false,
          quotes_estimates: false,
          staff_management: false,
          loyalty_program: false,
          coupons_discounts: false,
          payment_links: false,
        },
        payment_methods: (tenant as any).payment_methods ?? {
          pagomovil: { enabled: true },
          cash: { enabled: true },
          bank_transfer: { enabled: false },
          card_online: { enabled: false },
        },
        checkout_fields: (tenant as any).checkout_fields ?? {
          delivery_address: { enabled: false, required: false },
          table_number: { enabled: true, required: true },
          notes: {
            enabled: true,
            required: false,
            label: "Instrucciones adicionales",
          },
          scheduled_datetime: { enabled: false, required: false },
          reference_person: { enabled: false, required: false },
          dni_cedula: { enabled: false, required: false },
        },
        config_hash: (tenant as any).config_hash ?? "legacy000000",
        contact: (tenant as any).contact ?? {},
        // campos legacy y nuevos métodos de pago
        pagomovil: tenant.pagomovil,
        bankAccounts: activeBankAccounts,
        transferAccounts: ((tenant as any).transferAccounts ?? []).filter(
          (a: any) => a.isActive,
        ),
        zelleAccounts: ((tenant as any).zelleAccounts ?? []).filter(
          (a: any) => a.isActive,
        ),
        usdRate,
        isOpen: this.computeIsOpen(tenant.schedule ?? null),
        schedule: tenant.schedule ?? null,
        orderModes,
        booking_settings: {
          deposit_pct: (tenant as any).booking_settings?.deposit_pct ?? 0,
          notify_email: (tenant as any).booking_settings?.notify_email ?? false,
          notify_whatsapp:
            (tenant as any).booking_settings?.notify_whatsapp ?? false,
        },
        // Upsell: solo exponer la config si está habilitada
        upsell: (tenant as any).upsell?.enabled
          ? {
              enabled: true,
              addOnProductIds: (tenant as any).upsell.addOnProductIds ?? [],
              bundleExtraPrice: (tenant as any).upsell.bundleExtraPrice ?? 0,
            }
          : undefined,
      };
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.logError(error, "TenantService.getPublicBySlug", { slug });
      throw error;
    }
  }

  // ── Upsell — PATCH admin/me/upsell ─────────────────────────────────
  async updateUpsell(
    tenantId: string,
    dto: {
      enabled?: boolean;
      addOnProductIds?: string[];
      bundleExtraPrice?: number;
    },
  ): Promise<{
    enabled: boolean;
    addOnProductIds: string[];
    bundleExtraPrice: number;
  }> {
    const tenant = await this.findById(tenantId);
    const current = (tenant as any).upsell ?? {
      enabled: false,
      addOnProductIds: [],
      bundleExtraPrice: 0,
    };
    const updated = {
      enabled: dto.enabled ?? current.enabled,
      addOnProductIds: dto.addOnProductIds ?? current.addOnProductIds,
      bundleExtraPrice: dto.bundleExtraPrice ?? current.bundleExtraPrice,
    };
    await this.tenantModel
      .findByIdAndUpdate(tenantId, { $set: { upsell: updated } })
      .exec();
    this.logger.log(`Upsell actualizado tenant=${tenantId}`, "TenantService");
    return updated;
  }

  // ── CRUD cuentas bancarias (P1.16) ──────────────────────────────────

  async getBankAccounts(tenantId: string): Promise<BankAccount[]> {
    const tenant = await this.findById(tenantId);
    return (tenant.bankAccounts ?? []).map((a) => ({
      _id: String(a._id),
      bank: a.bank,
      phone: a.phone,
      rif: a.rif,
      accountHolder: a.accountHolder,
      isDefault: a.isDefault,
      isActive: a.isActive,
      bankCode: a.bankCode ?? undefined,
      qrImageUrl: a.qrImageUrl ?? null,
      qrRawPayload: a.qrRawPayload ?? null,
    })) as BankAccount[];
  }

  async addBankAccount(
    tenantId: string,
    dto: CreateBankAccountDto,
  ): Promise<BankAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts = tenant.bankAccounts ?? [];

    // Límite total (activas + inactivas) — previene bypass por desactivación
    const limit = getPlanLimit(
      (tenant as any).plan ?? "starter",
      "bankAccounts",
    );
    if (accounts.length >= limit) {
      throw new BadRequestException(
        `Tu plan ${(tenant as any).plan ?? "starter"} permite hasta ${limit} cuenta(s) PagoMóvil. Editá la cuenta existente para cambiar los datos, o actualizá tu plan para agregar más.`,
      );
    }

    // Si es la primera cuenta O viene marcada como default, quitar el default de las otras
    const makeDefault = dto.isDefault ?? accounts.length === 0;

    const newAccount = {
      _id: new Types.ObjectId(),
      bank: dto.bank,
      phone: dto.phone,
      rif: dto.rif,
      accountHolder: dto.accountHolder,
      isDefault: makeDefault,
      isActive: true,
      bankCode: dto.bankCode ?? null,
      qrImageUrl: null,
      qrPublicId: null,
      qrRawPayload: dto.qrRawPayload?.trim() ? dto.qrRawPayload.trim() : null,
    };

    // Si se marca como default, quitar default de las demás
    const updatedAccounts = makeDefault
      ? accounts.map((a) => ({ ...a, isDefault: false }))
      : [...accounts];
    updatedAccounts.push(newAccount);

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { bankAccounts: updatedAccounts },
    });

    this.logger.log(
      `BankAccount añadida: tenant=${tenantId} bank=${dto.bank}`,
      "TenantService",
    );
    return this.getBankAccounts(tenantId);
  }

  async updateBankAccount(
    tenantId: string,
    accountId: string,
    dto: UpdateBankAccountDto,
  ): Promise<BankAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts = tenant.bankAccounts ?? [];
    const idx = accounts.findIndex((a) => String(a._id) === accountId);

    if (idx === -1)
      throw new NotFoundException(`Cuenta ${accountId} no encontrada`);

    // Nota: `UpdateBankAccountDto` NO incluye `isDefault` a propósito —
    // cambiar default tiene su propio endpoint (`setDefaultBankAccount`) que
    // mantiene la invariante "una sola default por tenant". El whitelist
    // del ValidationPipe descarta `isDefault` si viene en el body, así que
    // este merge siempre preserva el isDefault original.
    accounts[idx] = { ...accounts[idx], ...dto };

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { bankAccounts: accounts },
    });

    return this.getBankAccounts(tenantId);
  }

  async setDefaultBankAccount(
    tenantId: string,
    accountId: string,
  ): Promise<BankAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts = tenant.bankAccounts ?? [];

    const exists = accounts.some((a) => String(a._id) === accountId);
    if (!exists)
      throw new NotFoundException(`Cuenta ${accountId} no encontrada`);

    const updated = accounts.map((a) => ({
      ...a,
      isDefault: String(a._id) === accountId,
    }));

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { bankAccounts: updated },
    });

    this.logger.log(
      `Default bancario cambiado: tenant=${tenantId} account=${accountId}`,
      "TenantService",
    );
    return this.getBankAccounts(tenantId);
  }

  /**
   * PMV.3 — Setea/actualiza el QR S7B subido por el tenant para una cuenta bancaria.
   * Si la cuenta ya tenía un QR, devuelve el publicId viejo para que el caller
   * pueda eliminarlo de Cloudinary sin bloquear.
   */
  async setBankAccountQr(
    tenantId: string,
    accountId: string,
    qr: { qrImageUrl: string; qrPublicId: string; qrRawPayload: string | null },
  ): Promise<{ accounts: BankAccount[]; previousPublicId: string | null }> {
    const tenant = await this.findById(tenantId);
    const accounts = tenant.bankAccounts ?? [];
    const idx = accounts.findIndex((a) => String(a._id) === accountId);

    if (idx === -1)
      throw new NotFoundException(`Cuenta ${accountId} no encontrada`);

    const previousPublicId = accounts[idx].qrPublicId ?? null;
    accounts[idx] = {
      ...accounts[idx],
      qrImageUrl: qr.qrImageUrl,
      qrPublicId: qr.qrPublicId,
      qrRawPayload: qr.qrRawPayload,
    };

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { bankAccounts: accounts },
    });

    return { accounts: await this.getBankAccounts(tenantId), previousPublicId };
  }

  /**
   * PMV.3 — Limpia el QR S7B asociado a una cuenta. Devuelve el publicId
   * que tenía para que el caller pueda eliminarlo de Cloudinary.
   */
  async clearBankAccountQr(
    tenantId: string,
    accountId: string,
  ): Promise<{ accounts: BankAccount[]; previousPublicId: string | null }> {
    const tenant = await this.findById(tenantId);
    const accounts = tenant.bankAccounts ?? [];
    const idx = accounts.findIndex((a) => String(a._id) === accountId);

    if (idx === -1)
      throw new NotFoundException(`Cuenta ${accountId} no encontrada`);

    const previousPublicId = accounts[idx].qrPublicId ?? null;
    accounts[idx] = {
      ...accounts[idx],
      qrImageUrl: null,
      qrPublicId: null,
      qrRawPayload: null,
    };

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { bankAccounts: accounts },
    });

    return { accounts: await this.getBankAccounts(tenantId), previousPublicId };
  }

  async deleteBankAccount(
    tenantId: string,
    accountId: string,
  ): Promise<BankAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts = tenant.bankAccounts ?? [];
    const target = accounts.find((a) => String(a._id) === accountId);

    if (!target)
      throw new NotFoundException(`Cuenta ${accountId} no encontrada`);
    if (target.isDefault && accounts.filter((a) => a.isActive).length > 1) {
      throw new BadRequestException(
        "No podés borrar la cuenta predeterminada. Primero establecé otra como predeterminada.",
      );
    }

    const remaining = accounts.filter((a) => String(a._id) !== accountId);

    // Si queda sólo una activa y no tiene default, marcarla
    const activeLeft = remaining.filter((a) => a.isActive);
    if (activeLeft.length === 1 && !activeLeft[0].isDefault) {
      activeLeft[0].isDefault = true;
    }

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { bankAccounts: remaining },
    });

    return this.getBankAccounts(tenantId);
  }

  // ── Transfer Accounts CRUD ───────────────────────────────────────────

  async getTransferAccounts(tenantId: string): Promise<TransferAccount[]> {
    const tenant = await this.findById(tenantId);
    return ((tenant as any).transferAccounts ?? []) as TransferAccount[];
  }

  async addTransferAccount(
    tenantId: string,
    dto: CreateTransferAccountDto,
  ): Promise<TransferAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts: any[] = (tenant as any).transferAccounts ?? [];

    const limit = getPlanLimit(
      (tenant as any).plan ?? "starter",
      "transferAccounts",
    );
    if (accounts.length >= limit) {
      throw new BadRequestException(
        `Tu plan ${(tenant as any).plan ?? "starter"} permite hasta ${limit} cuenta(s) de transferencia. Editá la cuenta existente para cambiar los datos, o actualizá tu plan para agregar más.`,
      );
    }

    const makeDefault = dto.isDefault ?? accounts.length === 0;

    const newAccount = {
      _id: new Types.ObjectId(),
      subtype: dto.subtype,
      currency: dto.currency,
      accountHolder: dto.accountHolder,
      alias: dto.alias?.trim() || null,
      isDefault: makeDefault,
      isActive: true,
      bank: dto.bank?.trim() || null,
      accountNumber: dto.accountNumber?.trim() || null,
      accountType: dto.accountType || null,
      idNumber: dto.idNumber?.trim() || null,
      bankName: dto.bankName?.trim() || null,
      swift: dto.swift?.trim() || null,
      iban: dto.iban?.trim() || null,
      routingNumber: dto.routingNumber?.trim() || null,
      bankAddress: dto.bankAddress?.trim() || null,
    };

    const updated = makeDefault
      ? accounts.map((a) => ({ ...a, isDefault: false }))
      : [...accounts];
    updated.push(newAccount);

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { transferAccounts: updated },
    });
    this.logger.log(
      `TransferAccount añadida: tenant=${tenantId}`,
      "TenantService",
    );
    return this.getTransferAccounts(tenantId);
  }

  async updateTransferAccount(
    tenantId: string,
    accountId: string,
    dto: UpdateTransferAccountDto,
  ): Promise<TransferAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts: any[] = (tenant as any).transferAccounts ?? [];
    const idx = accounts.findIndex((a) => String(a._id) === accountId);
    if (idx === -1)
      throw new NotFoundException(
        `Cuenta de transferencia ${accountId} no encontrada`,
      );

    accounts[idx] = { ...accounts[idx], ...dto };
    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { transferAccounts: accounts },
    });
    return this.getTransferAccounts(tenantId);
  }

  async setDefaultTransferAccount(
    tenantId: string,
    accountId: string,
  ): Promise<TransferAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts: any[] = (tenant as any).transferAccounts ?? [];
    if (!accounts.some((a) => String(a._id) === accountId)) {
      throw new NotFoundException(
        `Cuenta de transferencia ${accountId} no encontrada`,
      );
    }
    const updated = accounts.map((a) => ({
      ...a,
      isDefault: String(a._id) === accountId,
    }));
    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { transferAccounts: updated },
    });
    return this.getTransferAccounts(tenantId);
  }

  async deleteTransferAccount(
    tenantId: string,
    accountId: string,
  ): Promise<TransferAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts: any[] = (tenant as any).transferAccounts ?? [];
    const target = accounts.find((a) => String(a._id) === accountId);
    if (!target)
      throw new NotFoundException(
        `Cuenta de transferencia ${accountId} no encontrada`,
      );
    if (target.isDefault && accounts.filter((a) => a.isActive).length > 1) {
      throw new BadRequestException(
        "No podés borrar la cuenta predeterminada. Primero establecé otra.",
      );
    }
    const remaining = accounts.filter((a) => String(a._id) !== accountId);
    const activeLeft = remaining.filter((a: any) => a.isActive);
    if (activeLeft.length === 1 && !activeLeft[0].isDefault)
      activeLeft[0].isDefault = true;
    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { transferAccounts: remaining },
    });
    return this.getTransferAccounts(tenantId);
  }

  // ── Zelle Accounts CRUD ──────────────────────────────────────────────

  async getZelleAccounts(tenantId: string): Promise<ZelleAccount[]> {
    const tenant = await this.findById(tenantId);
    return ((tenant as any).zelleAccounts ?? []) as ZelleAccount[];
  }

  async addZelleAccount(
    tenantId: string,
    dto: CreateZelleAccountDto,
  ): Promise<ZelleAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts: any[] = (tenant as any).zelleAccounts ?? [];

    const limit = getPlanLimit(
      (tenant as any).plan ?? "starter",
      "zelleAccounts",
    );
    if (accounts.length >= limit) {
      throw new BadRequestException(
        `Tu plan ${(tenant as any).plan ?? "starter"} permite hasta ${limit} cuenta(s) Zelle. Editá la cuenta existente para cambiar los datos, o actualizá tu plan para agregar más.`,
      );
    }

    const makeDefault = dto.isDefault ?? accounts.length === 0;

    const newAccount = {
      _id: new Types.ObjectId(),
      contactType: dto.contactType,
      contact: dto.contact.trim(),
      holderName: dto.holderName.trim(),
      bankApp: dto.bankApp?.trim() || null,
      alias: dto.alias?.trim() || null,
      isDefault: makeDefault,
      isActive: true,
    };

    const updated = makeDefault
      ? accounts.map((a) => ({ ...a, isDefault: false }))
      : [...accounts];
    updated.push(newAccount);

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { zelleAccounts: updated },
    });
    this.logger.log(
      `ZelleAccount añadida: tenant=${tenantId}`,
      "TenantService",
    );
    return this.getZelleAccounts(tenantId);
  }

  async updateZelleAccount(
    tenantId: string,
    accountId: string,
    dto: UpdateZelleAccountDto,
  ): Promise<ZelleAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts: any[] = (tenant as any).zelleAccounts ?? [];
    const idx = accounts.findIndex((a) => String(a._id) === accountId);
    if (idx === -1)
      throw new NotFoundException(`Cuenta Zelle ${accountId} no encontrada`);

    accounts[idx] = { ...accounts[idx], ...dto };
    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { zelleAccounts: accounts },
    });
    return this.getZelleAccounts(tenantId);
  }

  async setDefaultZelleAccount(
    tenantId: string,
    accountId: string,
  ): Promise<ZelleAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts: any[] = (tenant as any).zelleAccounts ?? [];
    if (!accounts.some((a) => String(a._id) === accountId)) {
      throw new NotFoundException(`Cuenta Zelle ${accountId} no encontrada`);
    }
    const updated = accounts.map((a) => ({
      ...a,
      isDefault: String(a._id) === accountId,
    }));
    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { zelleAccounts: updated },
    });
    return this.getZelleAccounts(tenantId);
  }

  async deleteZelleAccount(
    tenantId: string,
    accountId: string,
  ): Promise<ZelleAccount[]> {
    const tenant = await this.findById(tenantId);
    const accounts: any[] = (tenant as any).zelleAccounts ?? [];
    const target = accounts.find((a) => String(a._id) === accountId);
    if (!target)
      throw new NotFoundException(`Cuenta Zelle ${accountId} no encontrada`);
    if (target.isDefault && accounts.filter((a) => a.isActive).length > 1) {
      throw new BadRequestException(
        "No podés borrar la cuenta predeterminada. Primero establecé otra.",
      );
    }
    const remaining = accounts.filter((a) => String(a._id) !== accountId);
    const activeLeft = remaining.filter((a: any) => a.isActive);
    if (activeLeft.length === 1 && !activeLeft[0].isDefault)
      activeLeft[0].isDefault = true;
    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: { zelleAccounts: remaining },
    });
    return this.getZelleAccounts(tenantId);
  }

  // ── GET /tenants/me — admin carga su propia config ──────────────────
  async getMe(tenantId: string): Promise<TenantDocument> {
    return this.findById(tenantId);
  }

  // ── PATCH /tenants/me — admin actualiza su config ───────────────────
  async updateMe(
    tenantId: string,
    dto: UpdateTenantDto,
  ): Promise<TenantDocument> {
    try {
      const current = await this.findById(tenantId);

      // Merge parcial del theme: conservar lo que no viene en el DTO
      const theme = dto.theme
        ? { ...current.theme, ...dto.theme }
        : current.theme;

      // pagomovil se reemplaza completo (o se limpia con null)
      const pagomovil =
        dto.pagomovil === undefined ? current.pagomovil : dto.pagomovil;

      // orderModes: merge parcial — al menos un modo debe quedar activo
      let orderModes:
        | { dine_in: boolean; takeaway: boolean; delivery: boolean }
        | undefined;
      if (dto.orderModes !== undefined) {
        const currentModes = (current as any).orderModes ?? {
          dine_in: true,
          takeaway: false,
          delivery: false,
        };
        const merged = { ...currentModes, ...dto.orderModes };
        if (!merged.dine_in && !merged.takeaway && !merged.delivery) {
          throw new BadRequestException(
            "Al menos un modo de pedido debe estar activo.",
          );
        }
        orderModes = merged;
      }

      // contact: merge parcial — solo reemplaza campos enviados
      const contact = dto.contact
        ? { ...(current as any).contact, ...dto.contact }
        : (current as any).contact;

      const updated = (await this.tenantModel
        .findByIdAndUpdate(
          tenantId,
          {
            $set: {
              ...(dto.name !== undefined && { name: dto.name }),
              ...(dto.logo_url !== undefined && { logo_url: dto.logo_url }),
              ...(dto.cover_url !== undefined && { cover_url: dto.cover_url }),
              ...((dto as any).archetype !== undefined && {
                archetype: (dto as any).archetype,
              }),
              ...(dto.autoAcceptOrders !== undefined && {
                autoAcceptOrders: dto.autoAcceptOrders,
              }),
              // schedule: null = desactivar horario (siempre abierto), objeto = activar
              ...(dto.schedule !== undefined && { schedule: dto.schedule }),
              ...(orderModes !== undefined && { orderModes }),
              ...(dto.day_cutoff_hour !== undefined && {
                day_cutoff_hour: dto.day_cutoff_hour,
              }),
              theme,
              pagomovil,
              contact,
            },
          },
          { new: true },
        )
        .lean()
        .exec()) as unknown as TenantDocument | null;

      if (!updated)
        throw new NotFoundException("Tenant no encontrado al actualizar");

      this.logger.log(`Tenant actualizado: ${updated.slug}`, "TenantService");
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.logError(error, "TenantService.updateMe", { tenantId });
      throw error;
    }
  }

  // ── GET /tenants — superadmin lista todos ───────────────────────────
  async findAll(): Promise<TenantDocument[]> {
    try {
      return (await this.tenantModel
        .find()
        .sort({ createdAt: -1 })
        .lean()
        .exec()) as unknown as TenantDocument[];
    } catch (error) {
      this.logger.logError(error, "TenantService.findAll");
      throw error;
    }
  }

  // ── POST /tenants — superadmin da de alta tenant + admin inicial ────
  async createWithAdmin(dto: CreateTenantDto): Promise<CreateTenantResponse> {
    try {
      const slug = dto.tenantSlug.toLowerCase().trim();
      const email = dto.adminEmail.toLowerCase().trim();

      // 1) Asegurar unicidad del slug y del email antes de escribir nada
      const [existingTenant, existingUser] = await Promise.all([
        this.tenantModel.findOne({ slug }).lean().exec(),
        this.userModel.findOne({ email }).lean().exec(),
      ]);
      if (existingTenant) {
        throw new ConflictException(`El slug "${slug}" ya existe`);
      }
      if (existingUser) {
        throw new ConflictException(`El email "${email}" ya está registrado`);
      }

      // 2) Crear tenant — seed modules del plan starter para que los gates
      //    funcionen desde el primer día (guard devuelve true para undefined,
      //    lo que daría acceso libre a módulos pro en tenants recién creados).
      const starterModules = PLAN_MODULE_MAP["starter"] ?? {};
      const tenantDoc = await this.tenantModel.create({
        slug,
        name: dto.tenantName.trim(),
        plan: "starter",
        modules: starterModules,
        // logo_url, pagomovil: usan defaults del schema (null)
        // theme: usa default del schema
      });

      // 3) Crear usuario admin asociado al tenant
      //    AuthService.createUser hashea el password internamente con bcrypt
      try {
        await this.authService.createUser(
          email,
          dto.adminPassword,
          "admin",
          String(tenantDoc._id),
        );
      } catch (err) {
        // Rollback manual: si falla el alta del user, removemos el tenant
        // para no dejar estado huérfano en la BD (ideal: transacción Mongo,
        // pero Atlas M0 gratis no siempre soporta replica set / transactions)
        await this.tenantModel.findByIdAndDelete(tenantDoc._id).exec();
        throw err;
      }

      this.logger.log(
        `Tenant creado: slug=${slug} admin=${email}`,
        "TenantService",
      );

      // 4) Devolver respuesta limpia (sin password)
      const tenant = (await this.tenantModel
        .findById(tenantDoc._id)
        .lean()
        .exec()) as unknown as TenantDocument;

      const adminUser = await this.userModel.findOne({ email }).lean().exec();

      return {
        tenant: tenant as unknown as CreateTenantResponse["tenant"],
        admin: {
          _id: String(adminUser!._id),
          email,
          role: "admin",
          tenantId: String(tenantDoc._id),
        },
      };
    } catch (error) {
      if (
        error instanceof ConflictException ||
        error instanceof BadRequestException ||
        error instanceof ForbiddenException
      )
        throw error;
      this.logger.logError(error, "TenantService.createWithAdmin", {
        tenantSlug: dto.tenantSlug,
        adminEmail: dto.adminEmail,
      });
      throw error;
    }
  }

  // ── Superadmin: cambia el plan y ajusta módulos automáticamente ─────
  async changePlan(
    tenantId: string,
    plan: "starter" | "pro" | "enterprise",
  ): Promise<void> {
    const tenant = await this.tenantModel.findById(tenantId).lean().exec();
    if (!tenant)
      throw new NotFoundException(`Tenant ${tenantId} no encontrado`);

    const moduleOverrides = PLAN_MODULE_MAP[plan] ?? {};
    const arch = (tenant as any).business_types?.[0] as
      | BusinessType
      | undefined;

    // Solo aplicar overrides de módulos que son aplicables al arquetipo del tenant.
    // Esto previene que un cambio de plan habilite módulos de otros arquetipos
    // (ej: booking: true para tenants de arquetipo food).
    const archDefaults = arch ? (ARCHETYPE_MODULE_DEFAULTS[arch] ?? {}) : null;
    const relevantOverrides = archDefaults
      ? Object.fromEntries(
          Object.entries(moduleOverrides).filter(([k]) => k in archDefaults),
        )
      : moduleOverrides;

    await this.tenantModel.findByIdAndUpdate(tenantId, {
      $set: {
        plan,
        ...Object.fromEntries(
          Object.entries(relevantOverrides).map(([k, v]) => [
            `modules.${k}`,
            v,
          ]),
        ),
      },
    });
    this.logger.log(
      `Plan cambiado: tenant=${tenantId} plan=${plan} arch=${arch ?? "legacy"}`,
      "TenantService",
    );
  }

  // ── Admin activa/suspende un tenant (opcional para superadmin) ──────
  async setActive(tenantId: string, active: boolean): Promise<TenantDocument> {
    try {
      const updated = (await this.tenantModel
        .findByIdAndUpdate(tenantId, { $set: { active } }, { new: true })
        .lean()
        .exec()) as unknown as TenantDocument | null;

      if (!updated)
        throw new NotFoundException(`Tenant ${tenantId} no encontrado`);
      this.logger.log(
        `Tenant ${updated.slug} ${active ? "activado" : "suspendido"}`,
        "TenantService",
      );
      return updated;
    } catch (error) {
      if (error instanceof NotFoundException) throw error;
      this.logger.logError(error, "TenantService.setActive", {
        tenantId,
        active,
      });
      throw error;
    }
  }

  // ── Configurar (onboarding/alta) un tenant ──────────────────────────
  async configure(
    tenantId: string,
    dto: ConfigureTenantDto,
  ): Promise<TenantDocument> {
    try {
      if (!Types.ObjectId.isValid(tenantId)) {
        throw new BadRequestException("tenantId invalido");
      }

      const updated = (await this.tenantModel
        .findByIdAndUpdate(
          tenantId,
          {
            $set: {
              plan: dto.plan,
              business_types: dto.business_types,
              template_id: dto.template_id,
              modules: dto.modules || {},
              onboarded: true,
            },
          },
          { new: true },
        )
        .lean()
        .exec()) as unknown as TenantDocument | null;

      if (!updated)
        throw new NotFoundException(`Tenant ${tenantId} no encontrado`);

      this.logger.log(
        `Tenant ${updated.slug} configurado (onboarded) con plan=${dto.plan}, template=${dto.template_id}`,
        "TenantService.configure",
      );

      return updated;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      )
        throw error;
      this.logger.logError(error, "TenantService.configure", { tenantId, dto });
      throw error;
    }
  }
}
