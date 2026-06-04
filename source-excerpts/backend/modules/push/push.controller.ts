import {
  Controller,
  Post,
  Param,
  Body,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from "@nestjs/swagger";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { PushService } from "./push.service";
import { SubscribePushDto } from "./dto/subscribe-push.dto";
import { Order, OrderDocument } from "../order/schemas/order.schema";
import { TraceId } from "../../common/decorators/trace-id.decorator";
import { ParseSlugPipe } from "../../common/pipes/parse-slug.pipe";

/**
 * Endpoint público (sin auth) — el cliente final suscribe su device
 * para recibir notificaciones de su pedido.
 * Rate limit: 5 suscripciones por minuto por IP (evitar flood de subs).
 */
@Controller(":tenantSlug/orders/:orderId")
@ApiTags("Push (cliente)")
export class PushController {
  constructor(
    private readonly pushService: PushService,
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  @Post("subscribe-push")
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @ApiOperation({
    summary: "Suscribir device a notificaciones push de esta orden",
  })
  @ApiParam({ name: "tenantSlug" })
  @ApiParam({ name: "orderId" })
  @ApiResponse({ status: 201, description: "Suscripción registrada" })
  @ApiResponse({ status: 404, description: "Orden no encontrada" })
  async subscribe(
    @Param("tenantSlug", ParseSlugPipe) tenantSlug: string,
    @Param("orderId") orderId: string,
    @Body() dto: SubscribePushDto,
    @TraceId() traceId: string,
  ): Promise<{ ok: boolean }> {
    // Validar que la orden existe y pertenece al tenant
    const order = await this.orderModel
      .findById(orderId)
      .select("tenantSlug tenantId")
      .lean()
      .exec();

    if (!order) throw new NotFoundException("Orden no encontrada");
    if (order.tenantSlug !== tenantSlug) {
      throw new BadRequestException("La orden no pertenece a este negocio");
    }

    await this.pushService.subscribe({
      orderId,
      tenantId: String(order.tenantId),
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
      traceId,
    });

    return { ok: true };
  }
}
