import { Injectable, NestMiddleware } from "@nestjs/common";
import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

/**
 * TraceIdMiddleware
 *
 * Asigna un `traceId` a cada request entrante. Si el cliente lo envió en el
 * header `x-trace-id` lo reusamos (sirve cuando el front ya tenía uno del
 * request anterior y quiere correlacionar); si no, generamos uno nuevo.
 *
 * - Se adjunta a `req.traceId` para que interceptors/controllers/servicios
 *   puedan leerlo.
 * - Se setea en la response header `x-trace-id` para que el front lo lea y
 *   lo loggee.
 *
 * Convención del ID: UUID v4 sin guiones, 16 chars. Suficientemente único
 * en la práctica (2^64 posibilidades para una ventana de tiempo acotada) y
 * legible en logs/devtools.
 */
@Injectable()
export class TraceIdMiddleware implements NestMiddleware {
  use(
    req: Request & { traceId?: string },
    res: Response,
    next: NextFunction,
  ): void {
    const incoming = req.header("x-trace-id");
    const traceId =
      typeof incoming === "string" && /^[a-zA-Z0-9_-]{8,64}$/.test(incoming)
        ? incoming
        : generateTraceId();

    req.traceId = traceId;
    res.setHeader("x-trace-id", traceId);
    next();
  }
}

export function generateTraceId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 16);
}
