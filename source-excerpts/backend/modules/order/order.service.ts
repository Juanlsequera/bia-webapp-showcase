import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  ConflictException,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import {
  SocketEvent,
  Order as OrderDto,
  OrderStatus,
  OrderStatusResponse,
  PaymentMethod,
  PaymentStatus,
  OrderType,
  OrderArchetype,
} from "@foodorder/types";
import { Order, OrderDocument } from "./schemas/order.schema";
import {
  PickupCounter,
  PickupCounterDocument,
} from "./schemas/pickup-counter.schema";
import {
  DailyOrderCounter,
  DailyOrderCounterDocument,
} from "./schemas/daily-order-counter.schema";
import { Staff, StaffDocument } from "../booking/schemas/staff.schema";
import { getBusinessDate } from "../../common/utils/business-date.util";
import {
  CreateOrderDto,
  SubmitPagomovilDto,
  VerifyPagomovilDto,
  UpdateOrderStatusDto,
  ConfirmCashPaymentDto,
} from "./dto/order.dto";
import { AppLogger } from "../logger/logger.service";
import { TenantService } from "../tenant/tenant.service";
import { isAvailableNow } from "../menu/availability.helper";
import { MenuService } from "../menu/menu.service";
import { OrdersGateway } from "../gateway/orders.gateway";
import { PaymentTransactionService } from "../payment/payment-transaction.service";
import { BcvRateService } from "../bcv-rate/bcv-rate.service";
import { MediaService } from "../media/media.service";
import { PushService } from "../push/push.service";
import { getMachine, InvalidTransitionError } from "./state-machines/registry";
import { EmailService } from "../auth/email.service";
import { NotificationService } from "../notification/notification.service";
import * as crypto from "crypto";

// Operación de stock decrementado, con datos suficientes para restaurarla (BUG-04).
type StockOp = {
  productId: string;
  variantId: string | null;
  quantity: number;
  name: string;
};

@Injectable()
export class OrderService implements OnModuleInit, OnModuleDestroy {
  // BUG-05: timer del barrido de órdenes stale. In-process, single-replica.
  private staleOrderTimer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(PickupCounter.name)
    private pickupCounterModel: Model<PickupCounterDocument>,
    @InjectModel(DailyOrderCounter.name)
    private dailyOrderCounterModel: Model<DailyOrderCounterDocument>,
    @InjectModel(Staff.name) private staffModel: Model<StaffDocument>,
    private tenantService: TenantService,
    private menuService: MenuService,
    private logger: AppLogger,
    private gateway: OrdersGateway,
    private paymentTrx: PaymentTransactionService,
    private bcvRateService: BcvRateService,
    private mediaService: MediaService,
    private pushService: PushService,
    private emailService: EmailService,
    private notificationService: NotificationService,
  ) {}

  // ── BUG-05: barrido periódico de órdenes pending_verification stale ──────
  // Arranca un intervalo in-process que cancela órdenes pagomóvil que nunca se
  // verificaron y restaura su stock. Corre en una sola réplica (el proyecto
  // está fijado a 1 réplica en Render — ver CLAUDE.md §rate-limit).
  //
  // OJO: en Render free tier la API duerme tras 15 min de inactividad y el
  // event loop se congela — el intervalo no dispara mientras está dormida.
  // El keepalive la mantiene despierta la mayor parte del día, pero el fallback
  // confiable es el endpoint admin `POST /admin/orders/expire-stale` (manual o
  // disparado por un cron externo / UptimeRobot).
  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return; // no barrer durante tests/e2e
    const sweepMin = Number(process.env.STALE_ORDER_SWEEP_MINUTES ?? 15);
    const maxAgeMin = Number(process.env.STALE_ORDER_MAX_AGE_MINUTES ?? 30);
    if (!Number.isFinite(sweepMin) || sweepMin <= 0) return;
    this.staleOrderTimer = setInterval(() => {
      void this.expireStaleOrders(maxAgeMin).catch((err) =>
        this.logger.logError(err, "OrderService.staleOrderSweep"),
      );
    }, sweepMin * 60_000);
    // No mantener vivo el proceso solo por este timer.
    this.staleOrderTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.staleOrderTimer) clearInterval(this.staleOrderTimer);
  }

  // Serializa un OrderDocument a un Order "plano" para WebSocket.
  // Los eventos van por la red — conviene no exponer campos raros del doc
  // de Mongoose (__v, getters, etc.).
  // timestamps: true en el schema agrega createdAt/updatedAt en runtime pero
  // TypeScript no los ve en Order — accedemos via cast puntual.
  private toDto(doc: OrderDocument): OrderDto {
    const ts = doc as unknown as { createdAt: Date; updatedAt: Date };
    return {
      _id: String(doc._id),
      tenantId: String(doc.tenantId),
      tenantSlug: doc.tenantSlug,
      orderType: (doc.orderType ?? "dine_in") as OrderType,
      archetype: (doc.archetype ?? "food") as OrderArchetype,
      tableNumber: doc.tableNumber ?? null,
      customer_name: doc.customer_name ?? null,
      pickup_code: doc.pickup_code ?? null,
      items: doc.items.map((i) => ({
        productId: String(i.productId),
        productName: i.productName,
        productCategory: i.productCategory,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        notes: i.notes ?? null,
      })),
      status: doc.status as OrderStatus,
      total: doc.total,
      pricing: {
        total_usd: doc.pricing.total_usd,
        usd_rate: doc.pricing.usd_rate,
        rate_captured_at: doc.pricing.rate_captured_at,
        total_bs: doc.pricing.total_bs,
        rate_stale: doc.pricing.rate_stale,
      },
      traceId: doc.traceId ?? null,
      customer_phone: doc.customer_phone ?? null,
      orderNumber: (doc as any).orderNumber ?? null,
      orderDate: (doc as any).orderDate ?? null,
      staffId: doc.staffId ? String(doc.staffId) : null,
      bookingDatetime: doc.bookingDatetime
        ? doc.bookingDatetime.toISOString()
        : null,
      quote_amount: (doc as any).quote_amount ?? null,
      quote_notes: (doc as any).quote_notes ?? null,
      payment: {
        method: doc.payment.method as PaymentMethod,
        status: doc.payment.status as PaymentStatus,
        externalId: doc.payment.externalId ?? null,
        paidAt: doc.payment.paidAt ?? null,
        pagomovil_reference: doc.payment.pagomovil_reference ?? null,
        pagomovil_phone: doc.payment.pagomovil_phone ?? null,
        pagomovil_bank: doc.payment.pagomovil_bank ?? null,
        pagomovil_cedula: doc.payment.pagomovil_cedula ?? null,
        pagomovil_amount: doc.payment.pagomovil_amount ?? null,
        pagomovil_verified_by: doc.payment.pagomovil_verified_by ?? null,
        pagomovil_verified_at: doc.payment.pagomovil_verified_at ?? null,
        pagomovil_rejection_reason:
          doc.payment.pagomovil_rejection_reason ?? null,
        pagomovil_receipt_url: doc.payment.pagomovil_receipt_url ?? null,
        pagomovil_receipt_public_id:
          doc.payment.pagomovil_receipt_public_id ?? null,
        confirmed_by: doc.payment.confirmed_by ?? null,
        cancellation_reason: doc.payment.cancellation_reason ?? null,
        cancelled_by: doc.payment.cancelled_by ?? null,
      },
      createdAt: ts.createdAt,
      updatedAt: ts.updatedAt,
    };
  }

  // Emite un evento al cliente (mesa o takeaway) según el tipo de orden.
  private emitToClient(
    order: OrderDocument,
    event: string,
    data: unknown,
  ): void {
    const orderType = (order as any).orderType ?? "dine_in";
    if (orderType === "dine_in" && order.tableNumber !== null) {
      this.gateway.emitToTable(
        String(order.tenantId),
        order.tableNumber,
        event,
        data,
      );
    } else {
      this.gateway.emitToOrder(
        String(order.tenantId),
        String(order._id),
        event,
        data,
      );
    }
  }

  // ── CLIENTE: crea la comanda ──────────────────────────────────────────
  async createOrder(
    tenantSlug: string,
    dto: CreateOrderDto,
    traceId?: string,
  ): Promise<OrderDocument> {
    try {
      const tenant = await this.tenantService.findBySlug(tenantSlug);
      const tenantId = String(tenant._id);

      if (!dto.items?.length) {
        throw new BadRequestException("La orden no tiene items");
      }

      // Guardia de horario — rechazar si el negocio está cerrado en este momento
      const isOpen = this.tenantService.computeIsOpen(tenant.schedule ?? null);
      if (!isOpen) {
        const sched = tenant.schedule;
        const openMsg = sched
          ? `Abre a las ${String(sched.openHour).padStart(2, "0")}:00`
          : "Fuera de horario";
        throw new BadRequestException(`El negocio está cerrado. ${openMsg}.`);
      }

      // 1) Resolver productos reales desde Mongo (valida existencia, activo y pertenencia al tenant)
      const productIds = dto.items.map((i) => i.productId);
      const productMap = await this.menuService.findManyByIdsForTenant(
        productIds,
        tenantId,
      );

      // 2) Validar que todos los productos pedidos existen y están activos
      const missing = productIds.filter((id) => !productMap.has(id));
      if (missing.length) {
        throw new BadRequestException(
          `Productos no disponibles o inactivos: ${missing.join(", ")}`,
        );
      }

      // 2b) D3 — Rechazar ítems fuera de su ventana de disponibilidad programada
      const tz = (tenant as any).schedule?.timezone ?? "America/Caracas";
      const now = new Date();
      for (const item of dto.items) {
        const product = productMap.get(item.productId)!;
        const avail = (product as any).availability;
        if (avail && avail.mode === "scheduled") {
          const result = isAvailableNow(avail, tz, now);
          if (!result.available) {
            const hint = result.label ? ` (${result.label})` : "";
            throw new BadRequestException(
              `"${product.name}" no está disponible en este momento${hint}`,
            );
          }
        }
      }

      // 3) Construir items con precios reales (NUNCA confiar en precio del payload)
      //    y validar stock disponible antes de comprometer la orden.
      let total = 0;
      const items = dto.items.map((item) => {
        const product = productMap.get(item.productId)!;
        if (item.quantity < 1) {
          throw new BadRequestException(
            `Cantidad invalida para ${product.name}: ${item.quantity}`,
          );
        }
        // Guard de stock + precio de variante (retail)
        let unitPrice = product.price;
        const variantId = (item as any).variantId as string | null | undefined;
        if (variantId) {
          const variants: any[] = (product as any).variants ?? [];
          const variant = variants.find(
            (v: any) => String(v._id) === variantId,
          );
          if (!variant) {
            throw new BadRequestException(
              `Variante ${variantId} no encontrada en "${product.name}"`,
            );
          }
          if (variant.price_override != null)
            unitPrice = variant.price_override;
          // Stock check por variante
          const vStock = variant.stock_qty as number | null;
          if (vStock !== null && vStock !== undefined) {
            if (vStock === 0)
              throw new BadRequestException(
                `"${product.name} - ${variant.name}" está agotado`,
              );
            if (vStock < item.quantity) {
              throw new BadRequestException(
                `"${product.name} - ${variant.name}" solo tiene ${vStock} unidad${vStock !== 1 ? "es" : ""} disponible${vStock !== 1 ? "s" : ""}`,
              );
            }
          }
        } else {
          // Stock check por producto (stock_qty preferido; fallback stockQuantity legacy)
          const stock = ((product as any).stock_qty ??
            (product as any).stockQuantity) as number | null;
          if (stock !== null && stock !== undefined) {
            if (stock === 0)
              throw new BadRequestException(`"${product.name}" está agotado`);
            if (stock < item.quantity) {
              throw new BadRequestException(
                `"${product.name}" solo tiene ${stock} unidad${stock !== 1 ? "es" : ""} disponible${stock !== 1 ? "s" : ""}`,
              );
            }
          }
        }
        const lineTotal = unitPrice * item.quantity;
        total += lineTotal;
        return {
          productId: new Types.ObjectId(item.productId),
          productName: product.name,
          productCategory: product.category,
          quantity: item.quantity,
          unitPrice,
          notes: item.notes ?? null,
          variantId: variantId ? new Types.ObjectId(variantId) : null,
        };
      });

      // Redondeo a 2 decimales para evitar artefactos de punto flotante
      total = Math.round(total * 100) / 100;

      // Snapshot de pricing USD↔Bs con la tasa BCV vigente en este instante.
      // Se guarda inmutable en la orden — si BCV publica nueva tasa después,
      // el cliente sigue pagando el `total_bs` con el que confirmó. Esto evita
      // disputas tipo "yo vi otro precio" cuando el cliente paga 5 minutos
      // después de armar el carrito.
      const usdRate = await this.bcvRateService.getCurrent();
      const totalBs = Math.round(total * usdRate.value * 100) / 100;
      const pricing = {
        total_usd: total,
        usd_rate: usdRate.value,
        rate_captured_at: new Date(usdRate.capturedAt),
        total_bs: totalBs,
        rate_stale: usdRate.stale,
      };

      // Derivar archetype anticipado para las validaciones siguientes
      const _archetype: string =
        (dto as any).archetype ??
        ((tenant as any).business_types?.[0] as string | undefined) ??
        "food";

      // Validar que el modo de pedido esté habilitado para este tenant.
      // Para archetype=service/booking saltamos esta validación — no siguen el flujo
      // dine_in/takeaway/delivery clásico de food/retail.
      const orderType = (dto.orderType ?? "dine_in") as OrderType;
      if (_archetype !== "service" && _archetype !== "booking") {
        const modes = (tenant as any).orderModes ?? {
          dine_in: true,
          takeaway: false,
          delivery: false,
        };
        if (orderType === "takeaway" && !modes.takeaway) {
          throw new BadRequestException(
            "Este negocio no tiene habilitados los pedidos para llevar.",
          );
        }
        if (orderType === "delivery" && !modes.delivery) {
          throw new BadRequestException(
            "Este negocio no tiene habilitado el delivery.",
          );
        }
        if (orderType === "dine_in" && !modes.dine_in) {
          throw new BadRequestException(
            "Este negocio no tiene habilitados los pedidos en mesa.",
          );
        }
      }

      // BUG-02: Validar que el método de pago esté habilitado para este tenant.
      // Para archetype=service saltamos: no se cobra hasta que la cotización sea aprobada.
      if (_archetype !== "service") {
        const pm = (tenant as any).payment_methods;
        const methodEnabled: Record<string, boolean> = {
          pagomovil: pm?.pagomovil?.enabled ?? true,
          cash: pm?.cash?.enabled ?? true,
          bank_transfer: pm?.bank_transfer?.enabled ?? false,
          card_online: pm?.card_online?.enabled ?? false,
          debit_card: true, // siempre habilitado (físico en caja)
        };
        if (!methodEnabled[dto.paymentMethod]) {
          throw new BadRequestException(
            `Método de pago '${dto.paymentMethod}' no está habilitado para este negocio.`,
          );
        }
      }

      // Validación condicional: mesa requerida para dine_in, nombre para takeaway
      if (orderType === "dine_in" && !dto.tableNumber) {
        throw new BadRequestException(
          "tableNumber es obligatorio para pedidos en mesa.",
        );
      }
      if (orderType !== "dine_in" && !dto.customer_name) {
        throw new BadRequestException(
          "customer_name es obligatorio para pedidos sin mesa.",
        );
      }

      // Generar pickup_code para takeaway (atómico por tenant + día local)
      let pickupCode: string | null = null;
      if (orderType === "takeaway") {
        const tz = tenant.schedule?.timezone ?? "America/Caracas";
        const dateStr = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
        }).format(new Date());
        const counter = await this.pickupCounterModel.findOneAndUpdate(
          { tenantId: tenant._id, date: dateStr },
          { $inc: { counter: 1 } },
          { upsert: true, new: true },
        );
        // BUG-09: padStart(3) → T-001..T-999 sin romper el layout del KDS al pasar de T-99 a T-100
        pickupCode = `T-${String(counter.counter).padStart(3, "0")}`;
      }

      // Estado inicial según archetype y método de pago:
      // - service   → 'inquiry' (sin pago: el admin cotiza, luego aprueba)
      // - booking   → 'scheduled' (independiente del método de pago)
      // - cash      → 'pending_cash' (el cajero debe confirmar al cobrar)
      // - pagomovil → 'confirmed' esperando que el cliente envíe la referencia
      // - stripe/mp → 'confirmed' (el webhook lo aprueba automáticamente)
      const initialStatus: string =
        _archetype === "service"
          ? "inquiry"
          : _archetype === "booking"
            ? "scheduled"
            : dto.paymentMethod === "cash" || dto.paymentMethod === "debit_card"
              ? "pending_cash"
              : "confirmed";

      // Derivar archetype: del DTO, o del primer business_type del tenant, o 'food'
      const archetype: OrderArchetype =
        (dto as any).archetype ??
        ((tenant as any).business_types?.[0] as OrderArchetype | undefined) ??
        "food";

      // H3: Validación cruzada archetype ↔ campos booking
      let _bookingStaffName: string | null = null;
      if (archetype === "booking") {
        // Booking requiere staffId y bookingDatetime
        if (!dto.staffId || !dto.bookingDatetime) {
          throw new BadRequestException(
            "Para bookings: staffId y bookingDatetime son obligatorios",
          );
        }
        // Anti double-booking: slot libre antes de crear
        const conflict = await this.orderModel.findOne({
          tenantId: tenant._id,
          staffId: new Types.ObjectId(dto.staffId),
          bookingDatetime: new Date(dto.bookingDatetime),
          status: { $in: ["scheduled", "confirmed", "in_progress"] },
        });
        if (conflict) {
          throw new ConflictException(
            "El horario seleccionado ya está reservado. Por favor elegí otro.",
          );
        }
        // R5: Staff-service cross-validation — verificar que el profesional ofrece el servicio
        const staffDoc = (await this.staffModel
          .findOne({
            _id: new Types.ObjectId(dto.staffId),
            tenantId: tenant._id,
            active: true,
          })
          .lean()) as StaffDocument | null;
        if (!staffDoc) {
          throw new NotFoundException(
            "El profesional no existe o está inactivo",
          );
        }
        _bookingStaffName = (staffDoc as any).name ?? null;
        const staffServiceIds: string[] = (
          (staffDoc as any).serviceIds ?? []
        ).map((id: any) => String(id));
        if (staffServiceIds.length > 0) {
          const requestedIds = dto.items.map((i) => i.productId);
          const hasMatch = requestedIds.some((pid) =>
            staffServiceIds.includes(pid),
          );
          if (!hasMatch) {
            throw new BadRequestException(
              "El profesional seleccionado no ofrece el servicio solicitado.",
            );
          }
        }
      } else {
        // Non-booking: rechazar campos exclusivos de booking para evitar contaminación de datos
        if (dto.staffId || dto.bookingDatetime) {
          throw new BadRequestException(
            `staffId y bookingDatetime no aplican para archetype "${archetype}". Removelos del body.`,
          );
        }
      }

      // ── Decremento de stock ATÓMICO previo a crear la orden (BUG-04) ─────
      // El decremento es condicional (solo aplica si stock >= quantity). Si
      // alguno falla, el item se agotó entre la validación y este punto —
      // race con otro pedido concurrente. Restauramos lo ya decrementado y
      // abortamos con 409. Así NUNCA se crea una orden sin stock real.
      // Solo se incluyen items con tracking activo (stock_qty !== null); los
      // productos/variantes sin tracking no participan.
      const stockOps: StockOp[] = [];
      for (const item of dto.items) {
        const variantId = (item as any).variantId as string | null | undefined;
        const prod = productMap.get(item.productId);
        if (variantId) {
          const variants: any[] = (prod as any)?.variants ?? [];
          const variant = variants.find(
            (v: any) => String(v._id) === variantId,
          );
          const vStock = variant?.stock_qty as number | null | undefined;
          if (vStock !== null && vStock !== undefined) {
            stockOps.push({
              productId: item.productId,
              variantId,
              quantity: item.quantity,
              name: `${prod?.name ?? item.productId}${variant?.name ? ` - ${variant.name}` : ""}`,
            });
          }
        } else {
          const stock = ((prod as any)?.stock_qty ??
            (prod as any)?.stockQuantity) as number | null;
          if (stock !== null && stock !== undefined) {
            stockOps.push({
              productId: item.productId,
              variantId: null,
              quantity: item.quantity,
              name: prod?.name ?? item.productId,
            });
          }
        }
      }

      const appliedOps: StockOp[] = [];
      for (const op of stockOps) {
        const ok = op.variantId
          ? await this.menuService.decrementVariantStock(
              op.productId,
              op.variantId,
              op.quantity,
              tenantId,
            )
          : await this.menuService.decrementStock(
              op.productId,
              op.quantity,
              tenantId,
            );
        if (!ok) {
          await this.rollbackStock(appliedOps, tenantId, traceId);
          throw new ConflictException(
            `"${op.name}" se agotó mientras confirmabas tu pedido. Actualizá el menú e intentá de nuevo.`,
          );
        }
        appliedOps.push(op);
      }

      // ── Número de pedido diario ─────────────────────────────────────────
      // Calcula la "fecha de negocio" respetando el corte nocturno del tenant
      // y obtiene un número secuencial atómico para ese día.
      // El bloque está en try/catch propio — si el contador falla (primer
      // arranque, replica lag, etc.) la orden se crea igual con orderNumber=null
      // en vez de bloquear el flujo de pago del cliente.
      const orderTz = tenant.schedule?.timezone ?? "America/Caracas";
      const cutoffHour = (tenant as any).day_cutoff_hour ?? 0;
      const orderDate = getBusinessDate(new Date(), cutoffHour, orderTz);
      let orderNumber: number | null = null;
      try {
        const orderCounter = await this.dailyOrderCounterModel.findOneAndUpdate(
          { tenantId: tenant._id, date: orderDate },
          { $inc: { counter: 1 } },
          { upsert: true, new: true },
        );
        orderNumber = orderCounter?.counter ?? null;
      } catch (counterErr) {
        // Non-fatal: loguear y continuar. La orden se asigna sin número diario.
        this.logger.warn(
          `No se pudo asignar orderNumber para tenant ${tenantSlug}: ${String(counterErr)}`,
          "OrderService",
          traceId,
        );
      }
      // ──────────────────────────────────────────────────────────────────────

      // Seña (deposit) — snapshot inmutable del porcentaje vigente al crear la reserva.
      // Si el negocio cambia el % después, las órdenes previas mantienen su seña original.
      const depositPct =
        archetype === "booking"
          ? ((tenant as any).booking_settings?.deposit_pct ?? 0)
          : 0;
      const depositAmount =
        depositPct > 0
          ? Math.round(((total * depositPct) / 100) * 100) / 100
          : 0;

      // SEC-01: token de cancelación para reservas (booking archetype).
      // Enviado SOLO por email/WhatsApp — nunca devuelto en la respuesta API.
      const cancellationToken =
        archetype === "booking" ? crypto.randomBytes(32).toString("hex") : null;

      // El stock ya fue decrementado arriba. Si el create falla, restauramos
      // (compensación) para no dejar stock fantasma reservado.
      let order: OrderDocument;
      try {
        order = await this.orderModel.create({
          tenantId: tenant._id,
          tenantSlug,
          orderType,
          archetype,
          tableNumber:
            orderType === "dine_in" ? (dto.tableNumber ?? null) : null,
          customer_name: dto.customer_name ?? null,
          pickup_code: pickupCode,
          items,
          total,
          pricing,
          status: initialStatus,
          customer_phone: dto.customer_phone ?? null,
          customer_email: dto.customer_email ?? null,
          traceId: traceId ?? null,
          cancellation_token: cancellationToken,
          staffId:
            archetype === "booking" ? new Types.ObjectId(dto.staffId!) : null,
          bookingDatetime:
            archetype === "booking" ? new Date(dto.bookingDatetime!) : null,
          orderNumber,
          orderDate,
          payment: {
            method: dto.paymentMethod,
            status: "pending",
            deposit_pct: depositPct,
            deposit_amount: depositAmount,
          },
        });
      } catch (createErr) {
        await this.rollbackStock(appliedOps, tenantId, traceId);
        throw createErr;
      }

      const locationLabel =
        orderType === "dine_in"
          ? `mesa ${dto.tableNumber}`
          : `${orderType} ${pickupCode ?? ""} ${dto.customer_name ?? ""}`.trim();

      this.logger.log(
        `Comanda creada: ${String(order._id)} | ${locationLabel} | ` +
          `${dto.paymentMethod} | total=$${total} (Bs.${totalBs} @ ${usdRate.value}` +
          `${usdRate.stale ? " STALE" : ""}) | items=${items.length} | status=${initialStatus}`,
        "OrderService",
        traceId,
      );

      // Si es cash o debit_card → notificamos a cajero/admin para que vaya a cobrar.
      // (En el resto de métodos de pago la comanda aún no es "ejecutable"
      //  hasta que se apruebe el pago — ahí emitimos NEW_ORDER a cocina.)
      if (dto.paymentMethod === "cash" || dto.paymentMethod === "debit_card") {
        const dtoOrder = this.toDto(order);
        this.gateway.emitToKitchen(tenantId, SocketEvent.NEW_CASH_ORDER, {
          order: dtoOrder,
          traceId,
        });
        this.gateway.emitToAdmin(tenantId, SocketEvent.NEW_CASH_ORDER, {
          order: dtoOrder,
          traceId,
        });
      }

      // R2: Confirmación de reserva al cliente vía WhatsApp/email (fire-and-forget)
      if (archetype === "booking" && dto.bookingDatetime) {
        const bs = (tenant as any).booking_settings;
        const frontendUrl = process.env.FRONTEND_URL ?? "";
        const orderId = String(order._id);
        const cancelUrl =
          cancellationToken && frontendUrl
            ? `${frontendUrl}/${tenantSlug}/reservas/${orderId}/cancelar?token=${cancellationToken}`
            : null;
        void this.notificationService
          .notifyBookingConfirmed({
            customerPhone: dto.customer_phone ?? null,
            customerEmail: dto.customer_email ?? null,
            customerName: dto.customer_name ?? null,
            tenantName: (tenant as any).name,
            bookingDatetime: new Date(dto.bookingDatetime),
            staffName: _bookingStaffName,
            cancelUrl,
            tenantNotify: {
              notify_email: bs?.notify_email ?? false,
              notify_whatsapp: bs?.notify_whatsapp ?? true,
              whatsapp_instance_id: bs?.whatsapp_instance_id ?? null,
              whatsapp_token: bs?.whatsapp_token ?? null,
            },
          })
          .catch((err) =>
            this.logger.logError(
              err,
              "OrderService.createOrder.bookingConfirmation",
              {},
              traceId,
            ),
          );
      }

      return order;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ConflictException
      )
        throw error;
      this.logger.logError(
        error,
        "OrderService.createOrder",
        { tenantSlug, tableNumber: dto.tableNumber },
        traceId,
      );
      throw error;
    }
  }

  // ── CLIENTE: envía datos de PagoMóvil después de transferir ──────────
  async submitPagomovil(
    orderId: string,
    tenantSlug: string,
    dto: SubmitPagomovilDto,
    traceId?: string,
  ): Promise<OrderDocument> {
    try {
      const order = await this.findOrderById(orderId);

      if (order.tenantSlug !== tenantSlug) {
        throw new ForbiddenException("Orden no pertenece a este negocio");
      }
      if (order.payment.method !== "pagomovil") {
        throw new BadRequestException("Esta orden no usa PagoMóvil");
      }
      if (order.payment.status !== "pending") {
        throw new BadRequestException(
          `No se puede modificar una orden en estado: ${order.payment.status}`,
        );
      }

      // Seguridad: verificar que la referencia no haya sido usada antes en este tenant.
      // Previene el fraude de reutilización del mismo comprobante en múltiples pedidos.
      const duplicate = await this.orderModel
        .findOne({
          tenantId: order.tenantId,
          "payment.pagomovil_reference": dto.pagomovil_reference,
          _id: { $ne: new Types.ObjectId(orderId) },
        })
        .lean()
        .exec();

      if (duplicate) {
        this.logger.warn(
          `Referencia duplicada detectada: ${dto.pagomovil_reference} | orden nueva: ${orderId} | orden existente: ${String(duplicate._id)}`,
          "OrderService",
          traceId,
        );
        throw new BadRequestException(
          "Este número de referencia ya fue usado en otro pedido. Verificá el comprobante.",
        );
      }

      // BUG-03: Loguear discrepancia entre el monto enviado y el pricing snapshot
      const expectedBs = order.pricing?.total_bs;
      if (expectedBs && dto.pagomovil_amount) {
        const diff = Math.abs(dto.pagomovil_amount - expectedBs);
        const tolerance = expectedBs * 0.02; // 2% de tolerancia por redondeo
        if (diff > tolerance) {
          this.logger.warn(
            `[MONTO-DISCREPANCIA] Orden ${orderId}: esperado ${expectedBs} Bs, recibido ${dto.pagomovil_amount} Bs (diff ${diff.toFixed(2)} Bs)`,
            "OrderService",
            traceId,
          );
        }
      }

      const updated = (await this.orderModel
        .findByIdAndUpdate(
          orderId,
          {
            $set: {
              status: "pending_verification",
              "payment.status": "pending_verification",
              "payment.pagomovil_reference": dto.pagomovil_reference,
              "payment.pagomovil_phone": dto.pagomovil_phone,
              "payment.pagomovil_bank": dto.pagomovil_bank,
              "payment.pagomovil_cedula": dto.pagomovil_cedula ?? null,
              "payment.pagomovil_amount": dto.pagomovil_amount,
              "payment.pagomovil_date": dto.pagomovil_date ?? null,
            },
          },
          { new: true },
        )
        .lean()
        .exec()) as unknown as OrderDocument;

      // Registramos la transacción en la colección aparte para cerrar caja y auditoría.
      // Si la orden no tenía traceId (ej: creada antes del feature) usamos el del request.
      const effectiveTraceId = updated.traceId ?? traceId ?? "";
      // Copiamos el receipt_url que se persistió en la orden via attachReceipt
      // (si el cliente subió la imagen antes de hacer el PATCH).
      await this.paymentTrx.createPagomovilPending({
        tenantId: String(updated.tenantId),
        orderId: String(updated._id),
        traceId: effectiveTraceId,
        amount: dto.pagomovil_amount,
        reference: dto.pagomovil_reference,
        senderPhone: dto.pagomovil_phone,
        senderBank: dto.pagomovil_bank,
        beneficiaryPhone: dto.pagomovil_beneficiary_phone ?? null,
        beneficiaryBank: dto.pagomovil_beneficiary_bank ?? null,
        crossCheckStatus: dto.pagomovil_crosscheck ?? "unknown",
        receipt_url: updated.payment.pagomovil_receipt_url ?? null,
      });

      this.logger.log(
        `PagoMóvil recibido: orden ${orderId} | ref: ${dto.pagomovil_reference} | ${dto.pagomovil_bank}`,
        "OrderService",
        effectiveTraceId,
      );

      // Avisamos al panel admin que hay un pagomóvil para verificar.
      this.gateway.emitToAdmin(
        String(updated.tenantId),
        SocketEvent.PAYMENT_PENDING,
        {
          orderId: String(updated._id),
          tableNumber: updated.tableNumber,
          total: updated.total,
          pagomovil_reference: dto.pagomovil_reference,
          pagomovil_bank: dto.pagomovil_bank,
          traceId: effectiveTraceId,
        },
      );

      return updated;
    } catch (error) {
      this.logger.logError(
        error,
        "OrderService.submitPagomovil",
        { orderId },
        traceId,
      );
      throw error;
    }
  }

  // ── ADMIN: aprueba o rechaza el PagoMóvil ────────────────────────────
  async verifyPagomovil(
    orderId: string,
    tenantId: string,
    adminEmail: string,
    dto: VerifyPagomovilDto,
    traceId?: string,
  ): Promise<OrderDocument> {
    try {
      const order = await this.findOrderById(orderId);

      if (String(order.tenantId) !== tenantId) {
        throw new ForbiddenException("Orden no pertenece a tu negocio");
      }
      if (order.payment.status !== "pending_verification") {
        throw new BadRequestException(
          `La orden no está esperando verificación. Estado actual: ${order.payment.status}`,
        );
      }

      const isApproved = dto.decision === "approved";

      // Guard de aprobación con discrepancia de monto.
      // Si el cliente declaró un pagomovil_amount que difiere > 2% del esperado
      // (snapshot pricing al crear orden), bloqueamos la aprobación por default
      // para forzar al admin a confirmar manualmente. `force_approve: true` es
      // el escape — admin verifica en el banco y aprueba igual, queda auditado.
      // Esto evita aprobaciones accidentales de fraude (cliente declara $1
      // cuando debió pagar $300).
      if (isApproved) {
        const expectedBs = order.pricing?.total_bs;
        const declaredBs = order.payment.pagomovil_amount;
        if (expectedBs && declaredBs && expectedBs > 0) {
          const diff = Math.abs(declaredBs - expectedBs);
          const diffPct = (diff / expectedBs) * 100;
          if (diffPct > 2) {
            if (!dto.force_approve) {
              throw new BadRequestException(
                `El monto declarado (${declaredBs.toFixed(2)} Bs) difiere en ${diffPct.toFixed(1)}% ` +
                  `del esperado (${expectedBs.toFixed(2)} Bs). Verificá en tu banco el monto recibido. ` +
                  `Si está correcto, reenviá con force_approve: true.`,
              );
            }
            // force_approve aceptado pero con discrepancia — auditoría especial.
            this.logger.warn(
              `[FORCE-APPROVE-DISCREPANCY] ${adminEmail} aprobó orden ${orderId} ` +
                `con diff ${diffPct.toFixed(1)}% (esperado ${expectedBs} Bs, declarado ${declaredBs} Bs)`,
              "OrderService.verifyPagomovil",
              traceId,
            );
          }
        }
      }

      // Si el tenant tiene autoAcceptOrders activo, saltamos directo a `preparing`.
      const tenant = await this.tenantService.findById(tenantId);
      const approvedStatus =
        isApproved && tenant.autoAcceptOrders ? "preparing" : "paid";

      // Timestamps de transición — para analytics de cocina (ver order.schema.ts §timestamps)
      const now = new Date();
      const transitionFields: Record<string, Date> = {};
      if (isApproved && approvedStatus === "preparing")
        transitionFields.preparingAt = now;
      if (!isApproved) transitionFields.cancelledAt = now;

      const updated = (await this.orderModel
        .findByIdAndUpdate(
          orderId,
          {
            $set: {
              status: isApproved ? approvedStatus : "cancelled",
              "payment.status": isApproved ? "approved" : "rejected",
              "payment.paidAt": isApproved ? now : null,
              "payment.pagomovil_verified_by": adminEmail,
              "payment.pagomovil_verified_at": now,
              "payment.pagomovil_rejection_reason":
                dto.rejection_reason ?? null,
              ...transitionFields,
            },
          },
          { new: true },
        )
        .lean()
        .exec()) as unknown as OrderDocument;

      // Registro de review en la transacción asociada (para cerrar caja / audit).
      const effectiveTraceId = updated.traceId ?? traceId ?? "";
      await this.paymentTrx.applyReview(
        {
          orderId: String(updated._id),
          reviewedBy: adminEmail,
          decision: dto.decision,
          rejectionReason: dto.rejection_reason ?? null,
        },
        effectiveTraceId,
      );

      this.logger.log(
        `PagoMóvil ${dto.decision}: orden ${orderId} por ${adminEmail}` +
          (dto.rejection_reason ? ` — motivo: ${dto.rejection_reason}` : ""),
        "OrderService",
        effectiveTraceId,
      );

      // Si fue rechazado la orden queda cancelled — devolver stock al inventario
      // y limpiar el comprobante de Cloudinary (best-effort, no bloquea).
      // Sin el cleanup, acumulamos imágenes huérfanas → llena el free tier.
      if (!isApproved) {
        await this.restoreOrderStock(updated, effectiveTraceId);
        const receiptPublicId = updated.payment?.pagomovil_receipt_public_id;
        if (receiptPublicId) {
          void this.mediaService.deleteImage(receiptPublicId).catch(() => {
            /* best-effort: deleteImage ya loguea internamente */
          });
        }
      }

      if (isApproved) {
        // Cocina ya puede preparar. Al cliente le notificamos aprobación.
        const dtoOrder = this.toDto(updated);
        this.gateway.emitToKitchen(tenantId, SocketEvent.NEW_ORDER, {
          order: dtoOrder,
          traceId: effectiveTraceId,
        });
        this.gateway.emitToAdmin(tenantId, SocketEvent.NEW_ORDER, {
          order: dtoOrder,
          traceId: effectiveTraceId,
        });
        this.emitToClient(updated, SocketEvent.PAYMENT_APPROVED, {
          orderId: String(updated._id),
          tableNumber: updated.tableNumber ?? null,
          status: updated.status as OrderStatus,
          paymentStatus: updated.payment.status as PaymentStatus,
          traceId: effectiveTraceId,
        });
        // P1.15 — Push al cliente (falla silenciosamente si Push no está configurado)
        void this.pushService.notifyOrder(String(updated._id), {
          title: "¡Pago aprobado! 🎉",
          body: "Tu orden está siendo procesada. Te avisamos cuando esté lista.",
          url: `/${updated.tenantSlug}/orden/${String(updated._id)}/estado`,
        });
        // P2.2 — WhatsApp al cliente
        void this.notificationService.notifyPaymentApproved({
          customerPhone: (updated as any).customer_phone ?? null,
          customerName: (updated as any).customer_name ?? null,
          tenantName: tenant.name,
          orderTotal: updated.total ?? 0,
          totalBs: updated.pricing?.total_bs ?? 0,
          pickupCode: (updated as any).pickup_code ?? null,
          tableNumber: updated.tableNumber ?? null,
        });
      } else {
        // Rechazado — avisamos al cliente con el motivo para que reintente.
        this.emitToClient(updated, SocketEvent.PAYMENT_REJECTED, {
          orderId: String(updated._id),
          tableNumber: updated.tableNumber ?? null,
          rejectionReason: dto.rejection_reason ?? null,
          traceId: effectiveTraceId,
        });
        // P2.2 — WhatsApp al cliente
        void this.notificationService.notifyPaymentRejected({
          customerPhone: (updated as any).customer_phone ?? null,
          customerName: (updated as any).customer_name ?? null,
          tenantName: tenant.name,
          reason: dto.rejection_reason ?? null,
        });
      }

      return updated;
    } catch (error) {
      this.logger.logError(
        error,
        "OrderService.verifyPagomovil",
        { orderId, adminEmail, decision: dto.decision },
        traceId,
      );
      throw error;
    }
  }

  // ── CAJERO/ADMIN: confirma el cobro en efectivo ──────────────────────
  async confirmCashPayment(
    orderId: string,
    tenantId: string,
    operatorEmail: string,
    dto: ConfirmCashPaymentDto,
    traceId?: string,
  ): Promise<OrderDocument> {
    try {
      const order = await this.findOrderById(orderId);

      if (String(order.tenantId) !== tenantId) {
        throw new ForbiddenException("Orden no pertenece a tu negocio");
      }
      if (
        order.payment.method !== "cash" &&
        order.payment.method !== "debit_card"
      ) {
        throw new BadRequestException(
          `Esta orden no es en efectivo o débito (método: ${order.payment.method})`,
        );
      }
      if (order.status !== "pending_cash") {
        throw new BadRequestException(
          `La orden no está esperando cobro en efectivo. Estado actual: ${order.status}`,
        );
      }

      // Si el tenant tiene autoAcceptOrders activo, saltamos directo a `preparing`.
      const tenant = await this.tenantService.findById(tenantId);
      const paidStatus = tenant.autoAcceptOrders ? "preparing" : "paid";

      // Timestamp de transición — solo si saltó directo a preparing (auto-accept).
      const now = new Date();
      const transitionFields: Record<string, Date> = {};
      if (paidStatus === "preparing") transitionFields.preparingAt = now;

      const updated = (await this.orderModel
        .findByIdAndUpdate(
          orderId,
          {
            $set: {
              status: paidStatus,
              "payment.status": "approved",
              "payment.paidAt": now,
              "payment.confirmed_by": operatorEmail,
              ...transitionFields,
            },
          },
          { new: true },
        )
        .lean()
        .exec()) as unknown as OrderDocument;

      const effectiveTraceId = updated.traceId ?? traceId ?? "";

      this.logger.log(
        `Cobro efectivo confirmado: orden ${orderId} por ${operatorEmail}` +
          (tenant.autoAcceptOrders ? " [auto→preparing]" : "") +
          (dto.notes ? ` — nota: ${dto.notes}` : ""),
        "OrderService",
        effectiveTraceId,
      );

      // Registrar transacción en payment_transactions para auditoría de caja.
      // cash → amount en USD (order.total); debit_card → amount en Bs. (pricing.total_bs).
      // Best-effort: si falla el registro, el cobro ya está confirmado y no queremos
      // que una falla de auditoría deshaga la transacción comercial.
      void this.paymentTrx
        .createCashTransaction({
          tenantId,
          orderId: String(updated._id),
          traceId: effectiveTraceId,
          method: order.payment.method as "cash" | "debit_card",
          amount:
            order.payment.method === "debit_card"
              ? (updated.pricing?.total_bs ?? updated.total)
              : updated.total,
          confirmedBy: operatorEmail,
        })
        .catch((err) => {
          this.logger.warn(
            `No se pudo crear PaymentTransaction para orden ${orderId}: ${String(err)}`,
            "OrderService.confirmCashPayment",
            effectiveTraceId,
          );
        });

      // Cocina puede empezar a preparar + cliente ve "pago aprobado".
      const dtoOrder = this.toDto(updated);
      this.gateway.emitToKitchen(tenantId, SocketEvent.NEW_ORDER, {
        order: dtoOrder,
        traceId: effectiveTraceId,
      });
      this.gateway.emitToAdmin(tenantId, SocketEvent.NEW_ORDER, {
        order: dtoOrder,
        traceId: effectiveTraceId,
      });
      this.emitToClient(updated, SocketEvent.PAYMENT_APPROVED, {
        orderId: String(updated._id),
        tableNumber: updated.tableNumber ?? null,
        status: updated.status as OrderStatus,
        paymentStatus: updated.payment.status as PaymentStatus,
        traceId: effectiveTraceId,
      });
      // Push al cliente (efectivo confirmado)
      void this.pushService.notifyOrder(String(updated._id), {
        title: "¡Pago confirmado! 🎉",
        body: "Tu cobro fue registrado. Te avisamos cuando tu pedido esté listo.",
        url: `/${updated.tenantSlug}/orden/${String(updated._id)}/estado`,
      });
      // P2.2 — WhatsApp al cliente (efectivo confirmado)
      void this.notificationService.notifyCashConfirmed({
        customerPhone: (updated as any).customer_phone ?? null,
        customerName: (updated as any).customer_name ?? null,
        tenantName: tenant.name,
        tableNumber: updated.tableNumber ?? null,
        pickupCode: (updated as any).pickup_code ?? null,
      });

      return updated;
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException
      )
        throw error;
      this.logger.logError(
        error,
        "OrderService.confirmCashPayment",
        { orderId, operatorEmail },
        traceId,
      );
      throw error;
    }
  }

  // ── ADMIN/CAJERO: lista comandas esperando cobro en efectivo ─────────
  async getPendingCash(tenantId: string): Promise<OrderDocument[]> {
    try {
      return (await this.orderModel
        .find({
          tenantId: new Types.ObjectId(tenantId),
          status: "pending_cash",
        })
        .sort({ createdAt: 1 }) // más antiguas primero
        .lean()
        .exec()) as unknown as OrderDocument[];
    } catch (error) {
      this.logger.logError(error, "OrderService.getPendingCash", { tenantId });
      throw error;
    }
  }

  // ── COCINA: cambia el estado de la comanda ───────────────────────────
  async updateStatus(
    orderId: string,
    tenantId: string,
    operatorEmail: string,
    dto: UpdateOrderStatusDto,
    traceId?: string,
  ): Promise<OrderDocument> {
    try {
      const order = await this.findOrderById(orderId);

      if (String(order.tenantId) !== tenantId) {
        throw new ForbiddenException("Comanda no pertenece a tu negocio");
      }

      // Validar transición de estado
      const machine = getMachine(
        ((order as any).archetype ?? "food") as OrderArchetype,
      );
      if (!machine.canTransition(order.status, dto.status)) {
        throw new BadRequestException(
          `Transición inválida en arquetipo "${machine.archetype}": ${order.status} → ${dto.status}. Permitidas: ${machine.nextStates(order.status).join(", ") || "ninguna"}`,
        );
      }

      const cancelFields =
        dto.status === "cancelled"
          ? {
              "payment.cancellation_reason": dto.cancellation_reason ?? null,
              "payment.cancelled_by": operatorEmail,
            }
          : {};

      // Timestamp de transición top-level — para analytics de tiempos de cocina.
      // No tocamos el campo si la orden ya tenía un timestamp del mismo estado
      // (caso edge: re-transición por bug del cliente). Para eso usamos $set
      // que solo sobreescribe — si querés preservar el primer evento de cada
      // estado, en order.schema.ts se podría agregar un statusHistory[] aparte.
      const now = new Date();
      const transitionFields: Record<string, Date> = {};
      if (dto.status === "preparing") transitionFields.preparingAt = now;
      if (dto.status === "ready") transitionFields.readyAt = now;
      if (dto.status === "delivered") transitionFields.deliveredAt = now;
      if (dto.status === "cancelled") transitionFields.cancelledAt = now;

      const updated = (await this.orderModel
        .findByIdAndUpdate(
          orderId,
          {
            $set: { status: dto.status, ...cancelFields, ...transitionFields },
          },
          { new: true },
        )
        .lean()
        .exec()) as unknown as OrderDocument;

      const effectiveTraceId = updated.traceId ?? traceId ?? "";

      // Si la transición fue a cancelled, devolver el stock que se decrementó
      // al crear la orden. Idempotente: si el producto perdió el tracking o
      // se borró, restoreStock no hace nada.
      // También limpiamos el comprobante de Cloudinary si existe (best-effort)
      // — previene acumulación de huérfanos si la orden tenía pagomovil pero
      // se canceló antes de aprobarse.
      if (dto.status === "cancelled") {
        await this.restoreOrderStock(updated, effectiveTraceId);
        const receiptPublicId = updated.payment?.pagomovil_receipt_public_id;
        if (receiptPublicId) {
          void this.mediaService.deleteImage(receiptPublicId).catch(() => {
            /* best-effort */
          });
        }
      }

      this.logger.log(
        `Estado comanda: ${orderId} → ${dto.status}`,
        "OrderService",
        effectiveTraceId,
      );

      // Notificamos tanto al cliente (mesa o takeaway) como a la cocina.
      const payload = {
        orderId: String(updated._id),
        tableNumber: updated.tableNumber ?? null,
        status: updated.status as OrderStatus,
        traceId: effectiveTraceId,
      };
      this.emitToClient(updated, SocketEvent.ORDER_STATUS_CHANGED, payload);
      this.gateway.emitToKitchen(
        tenantId,
        SocketEvent.ORDER_STATUS_CHANGED,
        payload,
      );
      this.gateway.emitToAdmin(
        tenantId,
        SocketEvent.ORDER_STATUS_CHANGED,
        payload,
      );

      // P1.15 — Push al cliente según el estado
      if (dto.status === "preparing") {
        void this.pushService.notifyOrder(String(updated._id), {
          title: "Tu orden está en proceso 🔄",
          body: "Te avisamos cuando esté lista.",
          url: `/${updated.tenantSlug}/orden/${String(updated._id)}/estado`,
        });
      }
      if (dto.status === "ready") {
        const pickupCodeLabel = (updated as any).pickup_code
          ? ` (${(updated as any).pickup_code})`
          : "";
        void this.pushService.notifyOrder(String(updated._id), {
          title: `¡Tu pedido${pickupCodeLabel} está listo! 🍔`,
          body: "Pasá a buscar tu pedido — te estamos esperando.",
          url: `/${updated.tenantSlug}/orden/${String(updated._id)}/estado`,
        });
        // P2.2 — WhatsApp al cliente (pedido listo para retirar)
        // Fire-and-forget: fetch tenant name async, notificación no bloquea respuesta.
        void this.tenantService
          .findById(updated.tenantId.toString())
          .then((t) =>
            this.notificationService.notifyOrderReady({
              customerPhone: (updated as any).customer_phone ?? null,
              customerName: (updated as any).customer_name ?? null,
              tenantName: (t as any).name ?? updated.tenantSlug,
              pickupCode: (updated as any).pickup_code ?? null,
              tableNumber: updated.tableNumber ?? null,
            }),
          )
          .catch(() => {
            this.logger.warn(
              `No se pudo enviar notificación WhatsApp de pedido listo para orden ${orderId}`,
              "OrderService.updateStatus",
              effectiveTraceId,
            );
          }); // no bloquea la respuesta si falla la notificación
      }

      return updated;
    } catch (error) {
      this.logger.logError(
        error,
        "OrderService.updateStatus",
        { orderId, status: dto.status },
        traceId,
      );
      throw error;
    }
  }

  // ── ADMIN: lista comandas pendientes de verificación ─────────────────
  async getPendingVerification(tenantId: string): Promise<OrderDocument[]> {
    try {
      return (await this.orderModel
        .find({
          tenantId: new Types.ObjectId(tenantId),
          "payment.status": "pending_verification",
        })
        .sort({ createdAt: 1 }) // más antiguas primero
        .lean()
        .exec()) as unknown as OrderDocument[];
    } catch (error) {
      this.logger.logError(error, "OrderService.getPendingVerification", {
        tenantId,
      });
      throw error;
    }
  }

  // ── COCINA: lista comandas activas del tenant ─────────────────────────
  async getActiveOrders(tenantId: string): Promise<OrderDocument[]> {
    try {
      return (await this.orderModel
        .find({
          tenantId: new Types.ObjectId(tenantId),
          status: { $in: ["paid", "preparing", "ready"] },
        })
        .sort({ createdAt: 1 })
        .lean()
        .exec()) as unknown as OrderDocument[];
    } catch (error) {
      this.logger.logError(error, "OrderService.getActiveOrders", { tenantId });
      throw error;
    }
  }

  // ── CLIENTE: obtiene el estado de su comanda ──────────────────────────
  // Incluye `pricing` (snapshot USD↔Bs) para que la pantalla de "esperando
  // pago / pago aprobado" pueda mostrar el monto exacto en ambas monedas.
  async getOrderStatus(
    orderId: string,
    tenantSlug: string,
  ): Promise<OrderStatusResponse> {
    try {
      const order = await this.findOrderById(orderId);
      if (order.tenantSlug !== tenantSlug) {
        throw new ForbiddenException("Comanda no pertenece a este negocio");
      }
      return {
        orderId: String(order._id),
        tenantId: String(order.tenantId),
        status: order.status as OrderStatus,
        paymentStatus: order.payment.status as PaymentStatus,
        paymentMethod: order.payment.method as PaymentMethod,
        orderType: ((order as any).orderType ?? "dine_in") as OrderType,
        archetype: ((order as any).archetype ?? "food") as OrderArchetype,
        tableNumber: order.tableNumber ?? null,
        pickup_code: (order as any).pickup_code ?? null,
        customer_name: (order as any).customer_name ?? null,
        total: order.total,
        pricing: {
          total_usd: order.pricing.total_usd,
          usd_rate: order.pricing.usd_rate,
          rate_captured_at: order.pricing.rate_captured_at,
          total_bs: order.pricing.total_bs,
          rate_stale: order.pricing.rate_stale,
        },
        rejectionReason: order.payment.pagomovil_rejection_reason ?? null,
        traceId: order.traceId ?? null,
        orderNumber: (order as any).orderNumber ?? null,
        orderDate: (order as any).orderDate ?? null,
      };
    } catch (error) {
      this.logger.logError(error, "OrderService.getOrderStatus", { orderId });
      throw error;
    }
  }

  // ── CLIENTE: sube el screenshot del comprobante a Cloudinary (P1.13) ─
  /**
   * Persiste la imagen del comprobante de PagoMóvil en Cloudinary y guarda
   * la URL en el documento de la orden. Se llama ANTES de submitPagomovil
   * para que el admin pueda ver la imagen junto a los datos del form.
   *
   * @param orderId   ID de la orden (debe existir y ser pagomovil + pending)
   * @param tenantSlug Verificación de ownership
   * @param buffer    Contenido del archivo (ya validado: mime + tamaño)
   * @param traceId   Para correlación en logs
   */
  async attachReceipt(
    orderId: string,
    tenantSlug: string,
    buffer: Buffer,
    traceId?: string,
  ): Promise<{ url: string }> {
    try {
      const order = await this.findOrderById(orderId);

      if (order.tenantSlug !== tenantSlug) {
        throw new ForbiddenException("Orden no pertenece a este negocio");
      }
      if (order.payment.method !== "pagomovil") {
        throw new BadRequestException("Esta orden no usa PagoMóvil");
      }
      // Aceptamos pending y pending_verification (el cliente puede reintentar
      // el upload si el primer intento falló).
      if (!["pending", "pending_verification"].includes(order.payment.status)) {
        throw new BadRequestException(
          `No se puede adjuntar comprobante en estado: ${order.payment.status}`,
        );
      }

      // Ruta en Cloudinary: foodorder/<slug>/receipts/mesa{n}_{ts}_{orderId}
      const ts = Date.now();
      const { url, publicId } = await this.mediaService.uploadImage(buffer, {
        folder: `foodorder/${tenantSlug}/receipts`,
        filename: `mesa${order.tableNumber}_${ts}_${orderId}`,
      });

      await this.orderModel.findByIdAndUpdate(orderId, {
        $set: {
          "payment.pagomovil_receipt_url": url,
          "payment.pagomovil_receipt_public_id": publicId,
        },
      });

      this.logger.log(
        `Comprobante subido: orden ${orderId} | public_id=${publicId}`,
        "OrderService",
        traceId,
      );

      return { url };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ForbiddenException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      this.logger.logError(
        error,
        "OrderService.attachReceipt",
        { orderId },
        traceId,
      );
      throw error;
    }
  }

  // ── ADMIN: lista solicitudes de servicio (archetype=service) ─────────
  async getServiceOrders(tenantId: string): Promise<OrderDto[]> {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException("tenantId inválido");
    }
    const docs = (await this.orderModel
      .find({ tenantId: new Types.ObjectId(tenantId), archetype: "service" })
      .sort({ createdAt: -1 })
      .limit(200)
      .exec()) as OrderDocument[];
    return docs.map((d) => this.toDto(d));
  }

  // ── ADMIN: envía cotización — transiciona inquiry → quoted ────────────
  async submitQuote(
    orderId: string,
    dto: import("./dto/order.dto").SubmitQuoteDto,
    user: import("@foodorder/types").AuthUser,
  ): Promise<OrderDto> {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException("ID de orden inválido");
    }
    const tenantId = user.tenantId!;
    const order = (await this.orderModel
      .findOne({
        _id: new Types.ObjectId(orderId),
        tenantId: new Types.ObjectId(tenantId),
      })
      .exec()) as OrderDocument | null;

    if (!order) throw new NotFoundException("Comanda no encontrada");
    if (order.archetype !== "service") {
      throw new BadRequestException(
        "Solo se pueden cotizar órdenes de archetype service",
      );
    }

    const machine = getMachine("service");
    if (!machine.canTransition(order.status as any, "quoted" as any)) {
      throw new BadRequestException(
        `No se puede cotizar una orden en estado '${order.status}'. Solo se permiten órdenes en 'inquiry'.`,
      );
    }

    const updated = (await this.orderModel
      .findByIdAndUpdate(
        order._id,
        {
          $set: {
            status: "quoted",
            quote_amount: dto.quote_amount,
            quote_notes: dto.quote_notes ?? null,
          },
        },
        { new: true },
      )
      .exec()) as OrderDocument;

    this.logger.log(
      `Cotización enviada: orden ${orderId} → quoted | quote_amount=$${dto.quote_amount}`,
      "OrderService",
    );

    const dtoOrder = this.toDto(updated);
    this.gateway.emitToAdmin(tenantId, "order:quoted", { order: dtoOrder });

    return dtoOrder;
  }

  // ── BUG-05: expira órdenes pending_verification abandonadas ───────────
  /**
   * Cancela las órdenes en `pending_verification` cuya última actualización
   * sea anterior al cutoff (`maxAgeMinutes`), restaura su stock y limpia el
   * comprobante de Cloudinary. Notifica al cliente y al admin por WS.
   *
   * Sin esto, un comprobante falso o abandonado deja el stock reservado para
   * siempre y llena la lista del admin de órdenes fantasma.
   *
   * @param maxAgeMinutes antigüedad mínima (en minutos) para considerar stale
   * @param tenantId      si se pasa, acota a un tenant (endpoint admin);
   *                      si se omite, barre todos (timer global)
   * @returns cantidad de órdenes expiradas
   */
  async expireStaleOrders(
    maxAgeMinutes = 30,
    tenantId?: string,
  ): Promise<{ expired: number }> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60_000);
    const filter: Record<string, unknown> = {
      status: "pending_verification",
      updatedAt: { $lt: cutoff },
    };
    if (tenantId) filter.tenantId = new Types.ObjectId(tenantId);

    const stale = (await this.orderModel
      .find(filter)
      .lean()
      .exec()) as unknown as OrderDocument[];
    let expired = 0;

    for (const order of stale) {
      try {
        const updated = (await this.orderModel
          .findByIdAndUpdate(
            order._id,
            {
              $set: {
                status: "cancelled",
                "payment.status": "rejected",
                "payment.cancellation_reason":
                  "Expirada por inactividad (sin verificar a tiempo)",
                cancelledAt: new Date(),
              },
            },
            { new: true },
          )
          .lean()
          .exec()) as unknown as OrderDocument;

        // Devolver stock + limpiar comprobante (best-effort, no aborta el resto).
        await this.restoreOrderStock(updated, updated.traceId ?? undefined);
        const receiptPublicId = updated.payment?.pagomovil_receipt_public_id;
        if (receiptPublicId) {
          void this.mediaService.deleteImage(receiptPublicId).catch(() => {
            /* best-effort */
          });
        }

        // Avisar al cliente (reutiliza el canal de rechazo) y al admin.
        this.emitToClient(updated, SocketEvent.PAYMENT_REJECTED, {
          orderId: String(updated._id),
          tableNumber: updated.tableNumber ?? null,
          rejectionReason:
            "Tu pago no se verificó a tiempo y la orden expiró. Podés pedir de nuevo.",
          traceId: updated.traceId ?? null,
        });
        this.gateway.emitToAdmin(
          String(updated.tenantId),
          SocketEvent.ORDER_STATUS_CHANGED,
          {
            orderId: String(updated._id),
            tableNumber: updated.tableNumber ?? null,
            status: "cancelled" as OrderStatus,
            traceId: updated.traceId ?? null,
          },
        );

        expired++;
      } catch (err) {
        this.logger.logError(err, "OrderService.expireStaleOrders", {
          orderId: String(order._id),
        });
      }
    }

    if (expired > 0) {
      this.logger.log(
        `Órdenes stale expiradas: ${expired} (cutoff ${maxAgeMinutes} min${tenantId ? `, tenant ${tenantId}` : ", global"})`,
        "OrderService",
      );
    }
    return { expired };
  }

  // ── helpers privados ──────────────────────────────────────────────────

  // Compensación de stock para BUG-04: restaura las unidades de los decrementos
  // ya aplicados cuando un decremento posterior falla (race) o el create de la
  // orden falla. Best-effort: errores individuales se loguean y no abortan el
  // resto — el objetivo es no dejar stock fantasma reservado.
  private async rollbackStock(
    ops: StockOp[],
    tenantId: string,
    traceId?: string,
  ): Promise<void> {
    await Promise.all(
      ops.map(async (op) => {
        try {
          if (op.variantId) {
            await this.menuService.restoreVariantStock(
              op.productId,
              op.variantId,
              op.quantity,
              tenantId,
            );
          } else {
            await this.menuService.restoreStock(
              op.productId,
              op.quantity,
              tenantId,
            );
          }
        } catch (err) {
          this.logger.logError(
            err,
            "OrderService.rollbackStock",
            { productId: op.productId },
            traceId,
          );
        }
      }),
    );
  }

  // Devuelve al stock todas las unidades de los items de la orden. Se usa
  // cuando una orden se cancela o rechaza tras haber decrementado stock en
  // createOrder. Si un producto perdió el tracking o fue eliminado en el
  // medio, restoreStock no hace nada (es idempotente). Errores individuales
  // no abortan el resto — se loguean y se siguen procesando los otros items.
  private async restoreOrderStock(
    order: OrderDocument,
    traceId?: string,
  ): Promise<void> {
    const tenantId = String(order.tenantId);
    await Promise.all(
      order.items.map(async (item) => {
        try {
          await this.menuService.restoreStock(
            String(item.productId),
            item.quantity,
            tenantId,
          );
        } catch (err) {
          this.logger.logError(
            err,
            "OrderService.restoreOrderStock",
            { orderId: String(order._id), productId: String(item.productId) },
            traceId,
          );
        }
      }),
    );
  }

  private async findOrderById(orderId: string): Promise<OrderDocument> {
    if (!Types.ObjectId.isValid(orderId)) {
      throw new BadRequestException("ID de orden inválido");
    }
    const order = (await this.orderModel
      .findById(orderId)
      .lean()
      .exec()) as unknown as OrderDocument | null;
    if (!order) throw new NotFoundException(`Comanda ${orderId} no encontrada`);
    return order;
  }
}
