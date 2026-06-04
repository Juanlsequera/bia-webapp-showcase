import { Injectable, BadRequestException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types, FilterQuery } from "mongoose";
import { Order, OrderDocument } from "../order/schemas/order.schema";
import { Tenant, TenantDocument } from "../tenant/schemas/tenant.schema";
import { AppLogger } from "../logger/logger.service";
import { AnalyticsQueryDto, OrdersQueryDto } from "./dto/analytics.dto";
import type {
  SummaryMetrics,
  ProductMetric,
  RevenueByDay,
  OrderRow,
  PaginatedResponse,
  GlobalMetrics,
  KitchenTimesMetric,
} from "@foodorder/types";

/**
 * Umbral en minutos para considerar un pedido "crítico" en cocina.
 * Si un pedido tarda más de esto entre `paid` y `ready`, se cuenta como crítico.
 * Configurable en el futuro vía TenantConfig si los negocios necesitan thresholds distintos.
 */
const CRITICAL_PREPARING_MINUTES = 15;

/**
 * Todas las métricas se calculan SOLO sobre comandas con `payment.status === 'approved'`.
 * Eso garantiza que un carrito abandonado, un pagomóvil rechazado o una orden cancelada
 * no ensucien los ingresos del negocio.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name) private orderModel: Model<OrderDocument>,
    @InjectModel(Tenant.name) private tenantModel: Model<TenantDocument>,
    private logger: AppLogger,
  ) {}

  // ── Endpoints admin ───────────────────────────────────────────────────

  async getSummary(
    tenantId: string,
    query: AnalyticsQueryDto,
  ): Promise<SummaryMetrics> {
    const { from, to, periodLabel } = this.resolvePeriod(query);
    const arch = await this.getArchetype(tenantId);
    const baseMatch = this.resolveBaseFilter(tenantId, from, to, arch);

    // 1) totalOrders + totalRevenue en una sola agregación.
    //    Usar pricing.total_usd (snapshot inmutable en USD) para consistencia.
    //    Fallback a $total para órdenes creadas antes del rediseño BCV (datos legacy).
    const [totals] = await this.orderModel.aggregate<{
      totalOrders: number;
      totalRevenue: number;
    }>([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ["$pricing.total_usd", "$total"] } },
        },
      },
    ]);

    // 2) topProduct: ranking por cantidad (más vendido)
    const [topProductDoc] = await this.orderModel.aggregate<{
      productName: string;
    }>([
      { $match: baseMatch },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          productName: { $first: "$items.productName" },
          totalQuantity: { $sum: "$items.quantity" },
        },
      },
      { $sort: { totalQuantity: -1 } },
      { $limit: 1 },
      { $project: { _id: 0, productName: 1 } },
    ]);

    const totalOrders = totals?.totalOrders ?? 0;
    const totalRevenue = this.round2(totals?.totalRevenue ?? 0);
    const averageTicket =
      totalOrders > 0 ? this.round2(totalRevenue / totalOrders) : 0;

    return {
      totalOrders,
      totalRevenue,
      averageTicket,
      topProduct: topProductDoc?.productName ?? null,
      periodLabel,
    };
  }

  async getTopProducts(
    tenantId: string,
    query: AnalyticsQueryDto,
  ): Promise<ProductMetric[]> {
    const { from, to } = this.resolvePeriod(query);
    const arch = await this.getArchetype(tenantId);
    const baseMatch = this.resolveBaseFilter(tenantId, from, to, arch);

    return this.orderModel.aggregate<ProductMetric>([
      { $match: baseMatch },
      { $unwind: "$items" },
      {
        $group: {
          _id: "$items.productId",
          productName: { $first: "$items.productName" },
          totalQuantity: { $sum: "$items.quantity" },
          totalRevenue: {
            $sum: { $multiply: ["$items.quantity", "$items.unitPrice"] },
          },
        },
      },
      {
        $project: {
          _id: 0,
          productId: { $toString: "$_id" },
          productName: 1,
          totalQuantity: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
        },
      },
      { $sort: { totalRevenue: -1, totalQuantity: -1 } },
    ]);
  }

  async getRevenueByDay(
    tenantId: string,
    query: AnalyticsQueryDto,
  ): Promise<RevenueByDay[]> {
    const { from, to } = this.resolvePeriod(query);
    const arch = await this.getArchetype(tenantId);
    const baseMatch = this.resolveBaseFilter(tenantId, from, to, arch);

    // Agrupa por fecha ISO YYYY-MM-DD. Usa pricing.total_usd con fallback legacy.
    return this.orderModel.aggregate<RevenueByDay>([
      { $match: baseMatch },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          revenue: { $sum: { $ifNull: ["$pricing.total_usd", "$total"] } },
          orders: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          revenue: { $round: ["$revenue", 2] },
          orders: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);
  }

  async getOrders(
    tenantId: string,
    query: OrdersQueryDto,
  ): Promise<PaginatedResponse<OrderRow>> {
    const { from, to } = this.resolvePeriod(query);
    const arch = await this.getArchetype(tenantId);
    const filter = this.buildOrdersFilter(tenantId, from, to, query, arch);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const skip = (page - 1) * limit;

    const [total, docs] = await Promise.all([
      this.orderModel.countDocuments(filter),
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec() as unknown as Promise<OrderDocument[]>,
    ]);

    const data: OrderRow[] = docs.map((o) => ({
      orderId: String(o._id),
      orderType: (o as any).orderType ?? "dine_in",
      tableNumber: o.tableNumber,
      pickup_code: (o as any).pickup_code ?? null,
      customer_name: (o as any).customer_name ?? null,
      total: o.total,
      status: o.status,
      paymentMethod: o.payment.method,
      itemCount: o.items.reduce((sum, it) => sum + it.quantity, 0),
      createdAt: (o as unknown as { createdAt: Date }).createdAt.toISOString(),
    }));

    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Exporta el historial completo en CSV con BOM UTF-8 (Excel lo abre bien así).
   * No aplica paginación — es una descarga completa del rango filtrado.
   * Protección: máximo 5000 filas por export para no reventar memoria en free tier.
   */
  async exportOrdersCsv(
    tenantId: string,
    query: OrdersQueryDto,
  ): Promise<string> {
    const { from, to } = this.resolvePeriod(query);
    const arch = await this.getArchetype(tenantId);
    const filter = this.buildOrdersFilter(tenantId, from, to, query, arch);

    const docs = (await this.orderModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(5000)
      .lean()
      .exec()) as unknown as OrderDocument[];

    const header = [
      "orderId",
      "createdAt",
      "orderType",
      "tableNumber",
      "pickup_code",
      "customer_name",
      "status",
      "paymentMethod",
      "paymentStatus",
      "itemCount",
      "total",
    ];

    const rows = docs.map((o) => [
      String(o._id),
      (o as unknown as { createdAt: Date }).createdAt.toISOString(),
      (o as any).orderType ?? "dine_in",
      String(o.tableNumber ?? ""),
      (o as any).pickup_code ?? "",
      (o as any).customer_name ?? "",
      o.status,
      o.payment.method,
      o.payment.status,
      String(o.items.reduce((sum, it) => sum + it.quantity, 0)),
      String(o.total),
    ]);

    const BOM = "\uFEFF";
    const csv =
      BOM +
      [header, ...rows]
        .map((cols) => cols.map(this.csvEscape).join(","))
        .join("\n");

    this.logger.log(
      `CSV export: tenant=${tenantId} | rango=${from.toISOString().slice(0, 10)}→${to.toISOString().slice(0, 10)} | filas=${rows.length}`,
      "AnalyticsService",
    );

    return csv;
  }

  // ── Endpoint superadmin ───────────────────────────────────────────────

  async getGlobalSummary(): Promise<GlobalMetrics> {
    const [totals] = await this.orderModel.aggregate<{
      totalOrders: number;
      totalRevenue: number;
    }>([
      { $match: { "payment.status": "approved" } },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          // pricing.total_usd es el campo canónico; fallback a legacy total
          totalRevenue: {
            $sum: { $ifNull: ["$pricing.total_usd", "$total"] },
          },
        },
      },
    ]);

    // topTenant: el que más facturó (por slug para legibilidad)
    const [topTenant] = await this.orderModel.aggregate<{ tenantSlug: string }>(
      [
        { $match: { "payment.status": "approved" } },
        {
          $group: {
            _id: "$tenantSlug",
            revenue: { $sum: { $ifNull: ["$pricing.total_usd", "$total"] } },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 1 },
        { $project: { _id: 0, tenantSlug: "$_id" } },
      ],
    );

    // Conteos de tenants directamente desde el modelo (evita dep circular con TenantService)
    const [totalTenants, activeTenants] = await Promise.all([
      this.tenantModel.countDocuments({}),
      this.tenantModel.countDocuments({ active: true }),
    ]);

    const orders = totals?.totalOrders ?? 0;
    const revenue = this.round2(totals?.totalRevenue ?? 0);

    return {
      totalTenants,
      activeTenants,
      totalOrders: orders,
      totalRevenue: revenue,
      averageTicket: orders > 0 ? this.round2(revenue / orders) : 0,
      topTenant: topTenant?.tenantSlug ?? null,
    };
  }

  async getTenantSummary(
    tenantId: string,
    query: AnalyticsQueryDto,
  ): Promise<SummaryMetrics> {
    // Reutiliza la misma lógica que admin — el superadmin sólo pasa otro tenantId.
    return this.getSummary(tenantId, query);
  }

  // ── Endpoints extra (métodos de pago, horas pico) ────────────────────

  async getPaymentMethodBreakdown(
    tenantId: string,
    query: AnalyticsQueryDto,
  ): Promise<{ method: string; totalOrders: number; totalRevenue: number }[]> {
    const { from, to } = this.resolvePeriod(query);
    const baseMatch = this.baseFilter(tenantId, from, to);

    return this.orderModel.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: "$payment.method",
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ["$pricing.total_usd", "$total"] } },
        },
      },
      {
        $project: {
          _id: 0,
          method: "$_id",
          totalOrders: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
        },
      },
      { $sort: { totalRevenue: -1 } },
    ]);
  }

  async getByHour(
    tenantId: string,
    query: AnalyticsQueryDto,
  ): Promise<{ hour: number; totalOrders: number; totalRevenue: number }[]> {
    const { from, to } = this.resolvePeriod(query);
    const arch = await this.getArchetype(tenantId);
    const baseMatch = this.resolveBaseFilter(tenantId, from, to, arch);

    // $hour devuelve UTC. Para Venezuela (UTC-4) el ajuste visual lo hace el frontend
    // etiquetando horas -4 en el tooltip.
    return this.orderModel.aggregate([
      { $match: baseMatch },
      {
        $group: {
          _id: { $hour: "$createdAt" },
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ["$pricing.total_usd", "$total"] } },
        },
      },
      {
        $project: {
          _id: 0,
          hour: "$_id",
          totalOrders: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
        },
      },
      { $sort: { hour: 1 } },
    ]);
  }

  /**
   * Métricas operativas de cocina (food rápida).
   *
   * Combina dos tipos de queries:
   *  1. Agregación para promedios sobre órdenes con timestamps completos
   *     (las creadas antes del cambio de schema quedan fuera — flagged en
   *     `totalMeasurable`).
   *  2. Conteo simple de canceladas para la tasa de cancelación.
   *
   * Importante: solo cuenta órdenes con `archetype: 'food'` (o legacy sin
   * archetype, que asumimos food). Booking/services no tienen tiempos de
   * cocina y meterlos al cálculo introduciría outliers.
   */
  async getKitchenTimes(
    tenantId: string,
    query: AnalyticsQueryDto,
  ): Promise<KitchenTimesMetric> {
    const { from, to } = this.resolvePeriod(query);

    const baseMatch: FilterQuery<OrderDocument> = {
      tenantId: new Types.ObjectId(tenantId),
      createdAt: { $gte: from, $lte: to },
      // food + legacy (sin archetype = asumimos food histórico)
      $or: [{ archetype: "food" }, { archetype: { $exists: false } }],
    };

    // 1) Conteo total + canceladas (incluye órdenes sin timestamps)
    const [counts] = await this.orderModel.aggregate<{
      totalOrders: number;
      cancelledOrders: number;
    }>([
      { $match: baseMatch },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          cancelledOrders: {
            $sum: { $cond: [{ $eq: ["$status", "cancelled"] }, 1, 0] },
          },
        },
      },
    ]);

    // 2) Promedios de tiempos — solo órdenes con los timestamps necesarios.
    //    Usamos `paidAt` como anchor del "inicio" del flujo de cocina porque
    //    es el primer evento del que cocina depende.
    const [times] = await this.orderModel.aggregate<{
      totalMeasurable: number;
      avgPreparingMs: number | null;
      avgDeliveryMs: number | null;
      avgTotalMs: number | null;
      criticalOrders: number;
    }>([
      { $match: baseMatch },
      {
        $project: {
          // paid → ready (lo que vio el cliente como "tiempo de cocina")
          preparingMs: {
            $cond: [
              { $and: ["$payment.paidAt", "$readyAt"] },
              { $subtract: ["$readyAt", "$payment.paidAt"] },
              null,
            ],
          },
          // ready → delivered (tiempo de entrega/retiro)
          deliveryMs: {
            $cond: [
              { $and: ["$readyAt", "$deliveredAt"] },
              { $subtract: ["$deliveredAt", "$readyAt"] },
              null,
            ],
          },
          // paid → delivered (tiempo total que el cliente esperó)
          totalMs: {
            $cond: [
              { $and: ["$payment.paidAt", "$deliveredAt"] },
              { $subtract: ["$deliveredAt", "$payment.paidAt"] },
              null,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          totalMeasurable: {
            $sum: { $cond: [{ $ne: ["$preparingMs", null] }, 1, 0] },
          },
          avgPreparingMs: { $avg: "$preparingMs" },
          avgDeliveryMs: { $avg: "$deliveryMs" },
          avgTotalMs: { $avg: "$totalMs" },
          criticalOrders: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $ne: ["$preparingMs", null] },
                    {
                      $gt: [
                        "$preparingMs",
                        CRITICAL_PREPARING_MINUTES * 60 * 1000,
                      ],
                    },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const totalOrders = counts?.totalOrders ?? 0;
    const cancelledOrders = counts?.cancelledOrders ?? 0;
    const totalMeasurable = times?.totalMeasurable ?? 0;
    const criticalOrders = times?.criticalOrders ?? 0;

    return {
      avgPreparingMinutes:
        times?.avgPreparingMs != null
          ? this.round2(times.avgPreparingMs / 60000)
          : null,
      avgDeliveryMinutes:
        times?.avgDeliveryMs != null
          ? this.round2(times.avgDeliveryMs / 60000)
          : null,
      avgTotalMinutes:
        times?.avgTotalMs != null
          ? this.round2(times.avgTotalMs / 60000)
          : null,
      criticalOrders,
      criticalRate:
        totalMeasurable > 0
          ? this.round2((criticalOrders / totalMeasurable) * 100)
          : 0,
      cancelledOrders,
      cancellationRate:
        totalOrders > 0
          ? this.round2((cancelledOrders / totalOrders) * 100)
          : 0,
      totalMeasurable,
      totalOrders,
      criticalThresholdMin: CRITICAL_PREPARING_MINUTES,
    };
  }

  // ── Endpoints superadmin (global) ─────────────────────────────────────

  async getGlobalRevenueByDay(
    query: AnalyticsQueryDto,
  ): Promise<RevenueByDay[]> {
    const { from, to } = this.resolvePeriod(query);

    return this.orderModel.aggregate<RevenueByDay>([
      {
        $match: {
          "payment.status": "approved",
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          revenue: { $sum: { $ifNull: ["$pricing.total_usd", "$total"] } },
          orders: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          date: "$_id",
          revenue: { $round: ["$revenue", 2] },
          orders: 1,
        },
      },
      { $sort: { date: 1 } },
    ]);
  }

  async getTenantsLeaderboard(query: AnalyticsQueryDto): Promise<
    {
      tenantId: string;
      tenantSlug: string;
      tenantName: string;
      totalOrders: number;
      totalRevenue: number;
      averageTicket: number;
    }[]
  > {
    const { from, to } = this.resolvePeriod(query);

    const rows = await this.orderModel.aggregate<{
      tenantId: string;
      tenantSlug: string;
      totalOrders: number;
      totalRevenue: number;
      averageTicket: number;
    }>([
      {
        $match: {
          "payment.status": "approved",
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: "$tenantId",
          tenantSlug: { $first: "$tenantSlug" },
          totalOrders: { $sum: 1 },
          totalRevenue: { $sum: { $ifNull: ["$pricing.total_usd", "$total"] } },
        },
      },
      {
        $project: {
          _id: 0,
          tenantId: { $toString: "$_id" },
          tenantSlug: 1,
          totalOrders: 1,
          totalRevenue: { $round: ["$totalRevenue", 2] },
          averageTicket: {
            $round: [
              {
                $cond: [
                  { $gt: ["$totalOrders", 0] },
                  { $divide: ["$totalRevenue", "$totalOrders"] },
                  0,
                ],
              },
              2,
            ],
          },
        },
      },
      { $sort: { totalRevenue: -1 } },
      { $limit: 20 },
    ]);

    // Enrich with tenant names from DB
    const tenantIds = rows
      .map((r) => r.tenantId)
      .filter((id) => Types.ObjectId.isValid(id))
      .map((id) => new Types.ObjectId(id));

    const tenants = await this.tenantModel
      .find({ _id: { $in: tenantIds } })
      .select("_id name")
      .lean()
      .exec();

    const nameMap = new Map(
      tenants.map((t) => [String(t._id), (t as any).name as string]),
    );

    return rows.map((r) => ({
      ...r,
      tenantName: nameMap.get(r.tenantId) ?? r.tenantSlug,
    }));
  }

  // ── Booking stats (archetype-specific) ───────────────────────────────

  async getBookingStats(
    tenantId: string,
    query: AnalyticsQueryDto,
  ): Promise<{
    total: number;
    completed: number;
    cancelled: number;
    noShow: number;
    active: number;
    completionRate: number;
    cancellationRate: number;
    noShowRate: number;
  }> {
    const { from, to } = this.resolvePeriod(query);

    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException("tenantId inválido");
    }

    const results = await this.orderModel.aggregate<{
      _id: string;
      count: number;
    }>([
      {
        $match: {
          tenantId: new Types.ObjectId(tenantId),
          archetype: "booking",
          createdAt: { $gte: from, $lte: to },
        },
      },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]);

    const byStatus: Record<string, number> = {};
    for (const r of results) {
      byStatus[r._id] = r.count;
    }

    const completed = byStatus["completed"] ?? 0;
    const cancelled = byStatus["cancelled"] ?? 0;
    const noShow = byStatus["no_show"] ?? 0;
    const total = results.reduce((s, r) => s + r.count, 0);
    const active = total - completed - cancelled - noShow;

    const completionRate =
      total > 0 ? Math.round((completed / total) * 100) : 0;
    const cancellationRate =
      total > 0 ? Math.round((cancelled / total) * 100) : 0;
    const noShowRate = total > 0 ? Math.round((noShow / total) * 100) : 0;

    return {
      total,
      completed,
      cancelled,
      noShow,
      active,
      completionRate,
      cancellationRate,
      noShowRate,
    };
  }

  // ── Service stats (archetype-specific) ──────────────────────────────

  async getServiceStats(
    tenantId: string,
    query: AnalyticsQueryDto,
  ): Promise<{
    total: number;
    byStatus: Record<string, number>;
    conversionRate: number;
    closeRate: number;
    avgRevenuePerJob: number;
  }> {
    const { from, to } = this.resolvePeriod(query);

    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException("tenantId inválido");
    }

    const results = await this.orderModel.aggregate<{
      _id: string;
      count: number;
      revenue: number;
    }>([
      {
        $match: {
          tenantId: new Types.ObjectId(tenantId),
          archetype: "service",
          createdAt: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
          revenue: { $sum: "$pricing.total_usd" },
        },
      },
    ]);

    const byStatus: Record<string, number> = {};
    let totalRevCompleted = 0;
    let countCompleted = 0;

    for (const r of results) {
      byStatus[r._id] = r.count;
      if (r._id === "completed") {
        totalRevCompleted = r.revenue ?? 0;
        countCompleted = r.count;
      }
    }

    const total = results.reduce((s, r) => s + r.count, 0);
    const approved = byStatus["approved"] ?? 0;
    const inProgress = byStatus["in_progress"] ?? 0;
    const completed = byStatus["completed"] ?? 0;

    const conversionRate =
      total > 0 ? Math.round((completed / total) * 100) : 0;
    const closeRate =
      total > 0
        ? Math.round(((approved + inProgress + completed) / total) * 100)
        : 0;
    const avgRevenuePerJob =
      countCompleted > 0
        ? Math.round((totalRevCompleted / countCompleted) * 100) / 100
        : 0;

    return { total, byStatus, conversionRate, closeRate, avgRevenuePerJob };
  }

  // ── Helpers privados ──────────────────────────────────────────────────

  /**
   * Lookup del archetype principal de un tenant.
   * Se llama una vez por método analítico para decidir qué filtro aplicar.
   * Lean + select para minimizar overhead.
   */
  private async getArchetype(tenantId: string): Promise<string | null> {
    if (!Types.ObjectId.isValid(tenantId)) return null;
    const t = await this.tenantModel
      .findById(tenantId)
      .select("business_types")
      .lean()
      .exec();
    return (t as any)?.business_types?.[0] ?? null;
  }

  /**
   * Filtro base ajustado por arquetipo.
   *
   * - **booking**: cuenta todas las citas confirmadas (status ≠ cancelled ≠ no_show),
   *   independientemente de si tienen pago aprobado. El flujo booking no requiere
   *   pre-pago — muchas citas se pagan en efectivo al final del servicio.
   *
   * - **food / retail / service / legacy**: solo órdenes con `payment.status=approved`
   *   para que el revenue refleje dinero real cobrado.
   *
   * `getPaymentMethodBreakdown` sigue usando `baseFilter` (que siempre requiere approved)
   * porque esa métrica es específicamente sobre transacciones de cobro, no sobre citas.
   */
  private resolveBaseFilter(
    tenantId: string,
    from: Date,
    to: Date,
    arch: string | null,
  ): FilterQuery<OrderDocument> {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException("tenantId inválido");
    }
    const tid = new Types.ObjectId(tenantId);

    if (arch === "booking") {
      return {
        tenantId: tid,
        archetype: "booking",
        status: { $nin: ["cancelled", "no_show"] },
        createdAt: { $gte: from, $lte: to },
      };
    }

    // food / retail / service / legacy
    return {
      tenantId: tid,
      "payment.status": "approved",
      createdAt: { $gte: from, $lte: to },
    };
  }

  private baseFilter(
    tenantId: string,
    from: Date,
    to: Date,
  ): FilterQuery<OrderDocument> {
    if (!Types.ObjectId.isValid(tenantId)) {
      throw new BadRequestException("tenantId inválido");
    }
    return {
      tenantId: new Types.ObjectId(tenantId),
      "payment.status": "approved",
      createdAt: { $gte: from, $lte: to },
    };
  }

  private buildOrdersFilter(
    tenantId: string,
    from: Date,
    to: Date,
    query: OrdersQueryDto,
    arch: string | null = null,
  ): FilterQuery<OrderDocument> {
    // For booking: show ALL appointments in the period (admin needs full history incl. cancelled).
    // For other archetypes: only payment-approved orders (revenue-accurate).
    const filter: FilterQuery<OrderDocument> =
      arch === "booking"
        ? {
            tenantId: new Types.ObjectId(tenantId),
            archetype: "booking",
            createdAt: { $gte: from, $lte: to },
          }
        : this.baseFilter(tenantId, from, to);

    if (query.status) filter.status = query.status;
    if (query.paymentMethod) filter["payment.method"] = query.paymentMethod;
    if (query.tableNumber) filter.tableNumber = query.tableNumber;
    if (query.orderType) filter.orderType = query.orderType;
    if (query.productId) {
      if (!Types.ObjectId.isValid(query.productId)) {
        throw new BadRequestException("productId inválido");
      }
      filter["items.productId"] = new Types.ObjectId(query.productId);
    }

    return filter;
  }

  /**
   * Resuelve el rango `[from, to]` a partir de los query params.
   * - Si vienen `dateFrom` y `dateTo`: usarlos (inclusive 00:00 → 23:59:59.999).
   * - Si no: defaultea a los últimos 30 días.
   * Además valida que `from <= to` para no devolver ventanas vacías silenciosas.
   */
  private resolvePeriod(query: AnalyticsQueryDto): {
    from: Date;
    to: Date;
    periodLabel: string;
  } {
    const now = new Date();
    let from: Date;
    let to: Date;

    if (query.dateFrom) {
      from = new Date(`${query.dateFrom}T00:00:00.000Z`);
      if (isNaN(from.getTime())) {
        throw new BadRequestException("dateFrom inválido");
      }
    } else {
      from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    if (query.dateTo) {
      to = new Date(`${query.dateTo}T23:59:59.999Z`);
      if (isNaN(to.getTime())) {
        throw new BadRequestException("dateTo inválido");
      }
    } else {
      to = now;
    }

    if (from > to) {
      throw new BadRequestException("dateFrom no puede ser posterior a dateTo");
    }

    const periodLabel = `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`;
    return { from, to, periodLabel };
  }

  private round2(n: number): number {
    return Math.round(n * 100) / 100;
  }

  /**
   * Escape para CSV: envuelve en comillas si el valor contiene coma, comilla,
   * salto de línea o retorno. Duplica las comillas internas (RFC 4180).
   */
  private csvEscape = (value: string): string => {
    if (/[",\n\r]/.test(value)) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };
}
