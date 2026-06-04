import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  OnModuleInit,
  OnModuleDestroy,
} from "@nestjs/common";
import * as crypto from "crypto";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { Staff, StaffDocument } from "./schemas/staff.schema";
import { AvailabilityResponse, BookingSlot, DayOfWeek } from "@foodorder/types";
import { CreateStaffDto } from "./dto/create-staff.dto";
import { UpdateStaffDto } from "./dto/update-staff.dto";
import { AppLogger } from "../logger/logger.service";
import { NotificationService } from "../notification/notification.service";
import { TenantService } from "../tenant/tenant.service";

@Injectable()
export class BookingService implements OnModuleInit, OnModuleDestroy {
  private reminderTimer?: ReturnType<typeof setInterval>;

  constructor(
    @InjectModel(Staff.name) private staffModel: Model<StaffDocument>,
    @InjectModel("Order") private orderModel: Model<any>,
    private readonly logger: AppLogger,
    private readonly notificationService: NotificationService,
    private readonly tenantService: TenantService,
  ) {}

  // ─── R1: Recordatorios automáticos 24h antes ───────────────────────────────
  // Corre cada 5 min (configurable con BOOKING_REMINDER_INTERVAL_MINUTES).
  // Busca bookings en el rango [now+23h, now+25h] con status scheduled/confirmed
  // y no recordados aún, les envía WhatsApp y los mueve a reminder_sent.
  onModuleInit(): void {
    if (process.env.NODE_ENV === "test") return;
    const intervalMin = Number(
      process.env.BOOKING_REMINDER_INTERVAL_MINUTES ?? 5,
    );
    if (!Number.isFinite(intervalMin) || intervalMin <= 0) return;
    this.reminderTimer = setInterval(() => {
      void this.sendBookingReminders().catch((err) =>
        this.logger.logError(err, "BookingService.reminderJob"),
      );
    }, intervalMin * 60_000);
    this.reminderTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.reminderTimer) clearInterval(this.reminderTimer);
  }

  async sendBookingReminders(): Promise<number> {
    const now = new Date();
    const windowStart = new Date(now.getTime() + 23 * 3_600_000);
    const windowEnd = new Date(now.getTime() + 25 * 3_600_000);

    const bookings = await this.orderModel
      .find({
        archetype: "booking",
        status: { $in: ["scheduled", "confirmed"] },
        bookingDatetime: { $gte: windowStart, $lte: windowEnd },
      })
      .populate("staffId", "name")
      .lean();

    if (bookings.length === 0) return 0;

    // Pre-fetch tenant configs keyed by tenantId (avoid N+1 for same-tenant bookings)
    const tenantConfigCache = new Map<string, any>();
    const getTenantConfig = async (tenantId: string): Promise<any> => {
      if (!tenantConfigCache.has(tenantId)) {
        try {
          const t = await this.tenantService.findById(tenantId);
          tenantConfigCache.set(tenantId, (t as any).booking_settings ?? {});
        } catch {
          tenantConfigCache.set(tenantId, {});
        }
      }
      return tenantConfigCache.get(tenantId);
    };

    let sent = 0;
    for (const booking of bookings) {
      try {
        await this.orderModel.updateOne(
          { _id: booking._id, status: { $in: ["scheduled", "confirmed"] } },
          { $set: { status: "reminder_sent" } },
        );

        const bs = await getTenantConfig(String((booking as any).tenantId));

        await this.notificationService.notifyBookingReminder({
          customerPhone: (booking as any).customer_phone ?? null,
          customerEmail: (booking as any).customer_email ?? null,
          customerName: (booking as any).customer_name ?? null,
          tenantName: (booking as any).tenantSlug,
          bookingDatetime: new Date((booking as any).bookingDatetime),
          staffName: (booking as any).staffId?.name ?? null,
          tenantNotify: {
            notify_email: bs?.notify_email ?? false,
            notify_whatsapp: bs?.notify_whatsapp ?? true,
            whatsapp_instance_id: bs?.whatsapp_instance_id ?? null,
            whatsapp_token: bs?.whatsapp_token ?? null,
          },
        });

        sent++;
      } catch (err) {
        this.logger.logError(err, "BookingService.sendBookingReminders", {
          bookingId: String(booking._id),
        });
      }
    }

    if (sent > 0) {
      this.logger.log(`Recordatorios enviados: ${sent}`, "BookingService");
    }
    return sent;
  }

  // ─── Staff Management ──────────────────────────────────────────────────────────

  async getStaffForService(
    tenantId: string,
    serviceId?: string,
  ): Promise<any[]> {
    const query: any = {
      tenantId: new Types.ObjectId(tenantId),
      active: true,
    };

    if (serviceId) {
      query.serviceIds = new Types.ObjectId(serviceId);
    }

    const staff = await this.staffModel.find(query).lean();
    return staff.map((s) => ({
      _id: s._id.toString(),
      name: s.name,
      avatar_url: s.avatar_url,
      bio: s.bio,
      services: (s.serviceIds || []).map((id) => id.toString()),
    }));
  }

  async create(tenantId: string, dto: CreateStaffDto): Promise<any> {
    const staff = new this.staffModel({
      tenantId: new Types.ObjectId(tenantId),
      name: dto.name,
      bio: dto.bio || null,
      avatar_url: dto.avatar_url || null,
      serviceIds: (dto.serviceIds || []).map((id) => new Types.ObjectId(id)),
      schedule: dto.schedule,
      active: true,
    });

    const saved = await staff.save();
    return this._formatStaffResponse(saved);
  }

  async update(
    tenantId: string,
    staffId: string,
    dto: UpdateStaffDto,
  ): Promise<any> {
    const staff = await this.staffModel.findOne({
      _id: new Types.ObjectId(staffId),
      tenantId: new Types.ObjectId(tenantId),
    });

    if (!staff) {
      throw new NotFoundException("Staff not found");
    }

    if (dto.name !== undefined) staff.name = dto.name;
    if (dto.bio !== undefined) staff.bio = dto.bio;
    if (dto.avatar_url !== undefined) staff.avatar_url = dto.avatar_url;
    if (dto.active !== undefined) staff.active = dto.active;
    if (dto.schedule !== undefined) staff.schedule = dto.schedule;
    if (dto.serviceIds !== undefined) {
      staff.serviceIds = dto.serviceIds.map((id) => new Types.ObjectId(id));
    }

    const updated = await staff.save();
    return this._formatStaffResponse(updated);
  }

  async remove(tenantId: string, staffId: string): Promise<void> {
    const result = await this.staffModel.deleteOne({
      _id: new Types.ObjectId(staffId),
      tenantId: new Types.ObjectId(tenantId),
    });

    if (result.deletedCount === 0) {
      throw new NotFoundException("Staff not found");
    }
  }

  async list(tenantId: string): Promise<any[]> {
    const staff = await this.staffModel
      .find({ tenantId: new Types.ObjectId(tenantId) })
      .lean();

    return staff.map((s) => this._formatStaffResponse(s));
  }

  // ─── Availability / Slots ──────────────────────────────────────────────────────

  async getAvailableSlots(
    tenantId: string,
    staffId: string,
    date: string, // YYYY-MM-DD
    serviceDurationMinutes: number = 60,
    timezone: string = "UTC",
  ): Promise<AvailabilityResponse> {
    const staff = await this.staffModel.findOne({
      _id: new Types.ObjectId(staffId),
      tenantId: new Types.ObjectId(tenantId),
    });

    if (!staff) {
      throw new NotFoundException("Staff not found");
    }

    // Validar formato de fecha
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("Date must be in YYYY-MM-DD format");
    }

    // Obtener día de la semana (0 = domingo, 1 = lunes, ...)
    const dayOfWeek = this._getDayOfWeek(date);
    const dayHours = staff.schedule[dayOfWeek];

    // Si el día está deshabilitado o bloqueado, retornar sin slots
    const slots: BookingSlot[] = [];
    if (!dayHours?.enabled || staff.schedule.blockedDates.includes(date)) {
      return { date, staffId, serviceDurationMinutes, slots };
    }

    // Parsear horarios — usar la timezone del tenant para que "09:00"
    // se interprete como 09:00 en hora local del negocio, no UTC.
    const startTime = this._parseTimeInTz(dayHours.open, date, timezone);
    const endTime = this._parseTimeInTz(dayHours.close, date, timezone);

    // Cargar bookings ya existentes para ese día y staff
    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);

    const existingBookings = await this.orderModel
      .find({
        tenantId: new Types.ObjectId(tenantId),
        archetype: "booking",
        staffId: new Types.ObjectId(staffId),
        bookingDatetime: { $gte: dayStart, $lte: dayEnd },
        status: { $nin: ["cancelled", "no_show"] },
      })
      .lean();

    const takenTimes = new Set(
      existingBookings.map((o: any) => o.bookingDatetime.getTime()),
    );

    // Generar slots cada `serviceDurationMinutes` minutos
    const slotDurationMs = serviceDurationMinutes * 60_000;
    let current = new Date(startTime);

    while (current.getTime() + slotDurationMs <= endTime.getTime()) {
      const slotTime = current.getTime();
      const available = !takenTimes.has(slotTime);

      slots.push({
        time: this._formatTime(current),
        datetime: current.toISOString(),
        available,
        orderId: null,
      });

      current = new Date(current.getTime() + slotDurationMs);
    }

    return { date, staffId, serviceDurationMinutes, slots };
  }

  // ─── Calendar Availability ────────────────────────────────────────────────────

  /**
   * Retorna los días del mes que tienen al menos 1 slot libre.
   * Si staffId es undefined, comprueba TODOS los staff activos del tenant (unión).
   * Útil para resaltar días disponibles en el calendario de reservas del cliente.
   */
  async getCalendarAvailability(
    tenantId: string,
    year: number,
    month: number, // 1-12
    serviceId?: string,
    staffId?: string,
    timezone = "UTC",
    serviceDurationMinutes = 60,
  ): Promise<string[]> {
    const daysInMonth = new Date(year, month, 0).getDate();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let staffIds: string[];
    if (staffId) {
      staffIds = [staffId];
    } else {
      const allStaff = await this.getStaffForService(tenantId, serviceId);
      staffIds = allStaff.map((s) => s._id);
    }

    if (staffIds.length === 0) return [];

    const availableDates: string[] = [];

    for (let day = 1; day <= daysInMonth; day++) {
      const mm = String(month).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      const dateStr = `${year}-${mm}-${dd}`;
      const dateObj = new Date(`${dateStr}T00:00:00`);
      if (dateObj < today) continue;

      let dayHasSlot = false;
      for (const sid of staffIds) {
        try {
          const result = await this.getAvailableSlots(
            tenantId,
            sid,
            dateStr,
            serviceDurationMinutes,
            timezone,
          );
          if (result.slots.some((s) => s.available)) {
            dayHasSlot = true;
            break;
          }
        } catch {
          // staff not found or inactive — skip
        }
      }

      if (dayHasSlot) availableDates.push(dateStr);
    }

    return availableDates;
  }

  /**
   * Retorna los slots disponibles como unión de todos los staff activos.
   * Cada slot disponible incluye `assignedStaffId` — el primer profesional
   * libre a esa hora, que el frontend usará al crear la orden.
   */
  async getAvailableSlotsForAnyStaff(
    tenantId: string,
    date: string,
    serviceDurationMinutes = 60,
    serviceId?: string,
    timezone = "UTC",
  ): Promise<{
    date: string;
    slots: Array<{
      time: string;
      available: boolean;
      assignedStaffId?: string;
    }>;
  }> {
    const allStaff = await this.getStaffForService(tenantId, serviceId);
    this.logger.log(
      `[slots-any] tenantId=${tenantId} date=${date} serviceId=${serviceId} duration=${serviceDurationMinutes} staffCount=${allStaff.length}`,
      "BookingService",
    );
    if (allStaff.length === 0) return { date, slots: [] };

    // Mapa: time → { available, assignedStaffId }
    const slotMap = new Map<
      string,
      { available: boolean; assignedStaffId?: string }
    >();

    for (const s of allStaff) {
      try {
        const result = await this.getAvailableSlots(
          tenantId,
          s._id,
          date,
          serviceDurationMinutes,
          timezone,
        );
        this.logger.log(
          `[slots-any] staff=${s._id} slotsGenerated=${result.slots.length} availableSlots=${result.slots.filter((sl) => sl.available).length}`,
          "BookingService",
        );
        for (const slot of result.slots) {
          const existing = slotMap.get(slot.time);
          if (!existing) {
            // Primera vez que vemos este horario
            slotMap.set(slot.time, {
              available: slot.available,
              assignedStaffId: slot.available ? s._id : undefined,
            });
          } else if (!existing.available && slot.available) {
            // Actualizar: este staff tiene el slot libre aunque el anterior no
            slotMap.set(slot.time, { available: true, assignedStaffId: s._id });
          }
        }
      } catch (err) {
        // staff not found or other error — skip
        this.logger.warn(
          `[slots-any] skipping staff ${s._id}: ${err}`,
          "BookingService",
        );
      }
    }

    const slots = Array.from(slotMap.entries())
      .map(([time, v]) => ({ time, ...v }))
      .sort((a, b) => a.time.localeCompare(b.time));

    return { date, slots };
  }

  // ─── Reschedule / Cancel ─────────────────────────────────────────────────────

  /**
   * SEC-01: Valida el token de cancelación con comparación en tiempo constante.
   * Si `providedToken` es undefined, la llamada proviene del admin (JWT validado
   * en el controller) — se omite la validación.
   * Si `providedToken` es string (puede ser vacío), se compara contra el token
   * almacenado en la orden. Lanza ForbiddenException si no coincide.
   *
   * Ordenes sin token (archetype != booking, o creadas antes del rollout)
   * se tratan como "legacy" — se omite la validación para no romper datos viejos.
   */
  private assertCancellationToken(
    storedToken: string | null | undefined,
    providedToken: string | undefined,
  ): void {
    // Admin bypass: no token en la request → caller es admin con JWT
    if (providedToken === undefined) return;
    // Legacy booking: sin token almacenado → no hay nada que validar
    if (!storedToken) return;
    try {
      const stored = Buffer.from(storedToken, "hex");
      const provided = Buffer.from(providedToken ?? "", "hex");
      if (
        stored.length !== provided.length ||
        !crypto.timingSafeEqual(stored, provided)
      ) {
        throw new ForbiddenException("Token de cancelación inválido");
      }
    } catch (err) {
      if (err instanceof ForbiddenException) throw err;
      // Buffer length mismatch o hex inválido → token incorrecto
      throw new ForbiddenException("Token de cancelación inválido");
    }
  }

  async rescheduleBooking(
    tenantId: string,
    orderId: string,
    staffId: string,
    bookingDatetime: string,
    cancellationToken?: string,
  ): Promise<any> {
    const order = await this.orderModel.findOne({
      _id: new Types.ObjectId(orderId),
      tenantId: new Types.ObjectId(tenantId),
    });
    if (!order) {
      throw new NotFoundException("Booking not found");
    }

    this.assertCancellationToken(
      (order as any).cancellation_token,
      cancellationToken,
    );

    const newDatetime = new Date(bookingDatetime);
    const newStaffId = new Types.ObjectId(staffId);

    // Anti double-booking: validar que el nuevo slot esté libre antes de
    // mover la reserva. Sin esto, 2 reschedules concurrentes pueden caer en
    // el mismo slot (el check existe en createOrder pero faltaba acá).
    // Excluye la propia orden del check (caso edge: reschedule al mismo slot).
    const conflict = await this.orderModel
      .findOne({
        tenantId: new Types.ObjectId(tenantId),
        archetype: "booking",
        staffId: newStaffId,
        bookingDatetime: newDatetime,
        status: { $nin: ["cancelled", "no_show"] },
        _id: { $ne: new Types.ObjectId(orderId) },
      })
      .lean();

    if (conflict) {
      throw new ConflictException(
        "Ese horario ya está ocupado por otra reserva. Elegí otro horario.",
      );
    }

    order.staffId = newStaffId;
    order.bookingDatetime = newDatetime;
    order.status = "rescheduled";
    const updated = await order.save();

    this.logger.log(
      `Booking rescheduled: ${orderId} → ${bookingDatetime} staff=${staffId}`,
      "BookingService",
    );

    return updated.toObject();
  }

  async cancelBooking(
    tenantId: string,
    orderId: string,
    reason?: string,
    cancellationToken?: string,
  ): Promise<any> {
    const order = await this.orderModel.findOne({
      _id: new Types.ObjectId(orderId),
      tenantId: new Types.ObjectId(tenantId),
    });
    if (!order) {
      throw new NotFoundException("Booking not found");
    }

    this.assertCancellationToken(
      (order as any).cancellation_token,
      cancellationToken,
    );

    order.status = "cancelled";
    if (reason) (order as any).cancellation_reason = reason;
    const updated = await order.save();

    this.logger.log(
      `Booking cancelled: ${orderId}${reason ? ` reason="${reason}"` : ""}`,
      "BookingService",
    );

    return updated.toObject();
  }

  // ─── Bookings (Orders view) ───────────────────────────────────────────────────

  async getBookingsByDate(tenantId: string, date: string): Promise<any[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new BadRequestException("Date must be in YYYY-MM-DD format");
    }

    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T23:59:59`);

    const bookings = await this.orderModel
      .find({
        tenantId: new Types.ObjectId(tenantId),
        archetype: "booking",
        bookingDatetime: { $gte: dayStart, $lte: dayEnd },
      })
      .populate("staffId", "name avatar_url")
      .lean();

    return bookings;
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────────

  private _getDayOfWeek(dateStr: string): DayOfWeek {
    const d = new Date(`${dateStr}T00:00:00`);
    const days: DayOfWeek[] = [
      "sunday",
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
    ];
    return days[d.getDay()];
  }

  private _parseTime(hhmm: string, date: string): Date {
    // Legacy — asume UTC. Mantener por compat; preferir _parseTimeInTz.
    return new Date(`${date}T${hhmm}:00Z`);
  }

  /**
   * Interpreta "HH:mm" como hora local en la timezone dada y devuelve un Date
   * (que internamente es UTC). Sin esto, los slots se calculan en UTC y se
   * desfasan para tenants fuera de UTC (ej. Caracas -04:00 → "09:00" se
   * mostraba como 13:00 local).
   *
   * Implementación sin dependencias: estima el offset de la zona en ese día
   * comparando dos parsings del mismo instante. Funciona correctamente para
   * Venezuela (sin DST). En zonas con DST puede haber 1h de imprecisión en
   * el día exacto del cambio — aceptable para slots de booking.
   */
  private _parseTimeInTz(hhmm: string, date: string, timezone: string): Date {
    if (timezone === "UTC") {
      return new Date(`${date}T${hhmm}:00Z`);
    }
    // Truco: tomamos el mismo instante interpretado como UTC vs interpretado
    // en la zona del tenant. La diferencia es el offset.
    const asIfUtc = new Date(`${date}T${hhmm}:00Z`);
    const utcStr = asIfUtc.toLocaleString("en-US", { timeZone: "UTC" });
    const tzStr = asIfUtc.toLocaleString("en-US", { timeZone: timezone });
    const offsetMs = new Date(utcStr).getTime() - new Date(tzStr).getTime();
    // El usuario quiso "hhmm en zona local" → restar el offset al UTC
    // simulado para alinear con el instante real correcto.
    return new Date(asIfUtc.getTime() + offsetMs);
  }

  private _formatTime(d: Date): string {
    const hours = String(d.getUTCHours()).padStart(2, "0");
    const minutes = String(d.getUTCMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  private _formatStaffResponse(staff: any) {
    return {
      _id: staff._id.toString(),
      name: staff.name,
      avatar_url: staff.avatar_url,
      bio: staff.bio,
      serviceIds: (staff.serviceIds || []).map((id: any) => id.toString()),
      schedule: staff.schedule,
      active: staff.active,
      createdAt: staff.createdAt,
      updatedAt: staff.updatedAt,
    };
  }
}
