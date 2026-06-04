import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { Request, Response } from "express";
import { AppLogger } from "../../modules/logger/logger.service";
import {
  RequestLogService,
  extractTenantSlug,
} from "../../modules/request-log/request-log.service";

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppLogger,
    // Opcional: inyectado desde main.ts una vez que AppModule inicializa el módulo.
    private readonly requestLogService?: RequestLogService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const traceId: string | undefined = (
      req as unknown as Record<string, unknown>
    ).traceId as string | undefined;

    const isHttp = exception instanceof HttpException;
    const status = isHttp
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const httpMessage = isHttp ? exception.getResponse() : undefined;

    // Loguear con stack completo. 5xx → error, 4xx → warn.
    if (status >= 500) {
      this.logger.logError(
        exception,
        "HttpExceptionFilter",
        {
          method: req.method,
          url: req.url,
          statusCode: status,
          traceId,
        },
        traceId,
      );
    } else {
      this.logger.warn(
        `${req.method} ${req.url} → ${status}`,
        "HttpExceptionFilter",
        traceId,
      );
    }

    // ── Persistencia en MongoDB (best-effort, no bloquea la respuesta) ───────
    if (this.requestLogService) {
      const errorMessage = (() => {
        if (!httpMessage)
          return exception instanceof Error
            ? exception.message
            : String(exception);
        if (typeof httpMessage === "string") return httpMessage;
        const msg = (httpMessage as Record<string, unknown>).message;
        return Array.isArray(msg)
          ? msg.join("; ")
          : String(msg ?? JSON.stringify(httpMessage));
      })();

      void this.requestLogService.persist({
        traceId: traceId ?? "unknown",
        method: req.method,
        url: req.url,
        statusCode: status,
        errorMessage,
        ip: req.ip ?? req.socket?.remoteAddress,
        userAgent: req.headers["user-agent"],
        tenantSlug: extractTenantSlug(req.url),
      });
    }

    // ── Cuerpo de respuesta ──────────────────────────────────────────────────
    const isDev = process.env.NODE_ENV !== "production";

    const userMessage = isHttp
      ? httpMessage
      : "Error del servidor. Intentá en unos minutos.";

    const debugDetail = (() => {
      if (!isDev || status < 500) return undefined;
      if (exception instanceof Error) return exception.message;
      return String(exception);
    })();

    res.status(status).json({
      statusCode: status,
      timestamp: new Date().toISOString(),
      path: req.url,
      traceId,
      message: userMessage,
      ...(debugDetail !== undefined ? { debug: debugDetail } : {}),
    });
  }
}
