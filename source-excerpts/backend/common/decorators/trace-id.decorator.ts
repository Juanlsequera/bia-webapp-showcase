import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { Request } from "express";

/**
 * `@TraceId()` — inyecta el traceId del request actual en un parámetro del
 * controller. Lo setea `TraceIdMiddleware` (ver common/middleware).
 *
 * Uso:
 *   @Post('orders')
 *   createOrder(@Body() dto: CreateOrderDto, @TraceId() traceId: string) { ... }
 */
export const TraceId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request & { traceId?: string }>();
    return req.traceId ?? "";
  },
);
