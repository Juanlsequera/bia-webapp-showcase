import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from "@nestjs/common";
import { Observable, tap } from "rxjs";
import { Request } from "express";
import { AppLogger } from "../../modules/logger/logger.service";

/**
 * Loggea cada HTTP request con método, url, duración y traceId. El traceId
 * lo setea TraceIdMiddleware antes que este interceptor corra.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  constructor(private readonly logger: AppLogger) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { traceId?: string }>();
    const { method, url } = req;
    const traceId = req.traceId;
    const start = Date.now();

    // Silenciar el probe de Render / UptimeRobot para no floodear logs
    // (se pegan cada 10s-10min contra /health).
    const isHealthProbe = url === "/health" || url.startsWith("/health?");

    return next.handle().pipe(
      tap({
        next: () => {
          if (!isHealthProbe) {
            this.logger.log(
              `${method} ${url} ${Date.now() - start}ms`,
              "HTTP",
              traceId,
            );
          }
        },
        // Los errores siempre se loggean, incluso en /health
        error: () =>
          this.logger.error(
            `${method} ${url} ${Date.now() - start}ms FAILED`,
            undefined,
            "HTTP",
            traceId,
          ),
      }),
    );
  }
}
