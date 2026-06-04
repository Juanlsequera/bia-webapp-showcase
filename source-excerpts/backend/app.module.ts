import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { MongooseModule } from "@nestjs/mongoose";
import { WinstonModule } from "nest-winston";
import { ThrottlerModule, ThrottlerGuard } from "@nestjs/throttler";
import { APP_GUARD } from "@nestjs/core";
import { AuthModule } from "./modules/auth/auth.module";
import { TenantModule } from "./modules/tenant/tenant.module";
import { OrderModule } from "./modules/order/order.module";
import { MenuModule } from "./modules/menu/menu.module";
import { AnalyticsModule } from "./modules/analytics/analytics.module";
import { HealthModule } from "./modules/health/health.module";
import { LoggerModule } from "./modules/logger/logger.module";
import { GatewayModule } from "./modules/gateway/gateway.module";
import { PaymentModule } from "./modules/payment/payment.module";
import { BcvRateModule } from "./modules/bcv-rate/bcv-rate.module";
import { PushModule } from "./modules/push/push.module";
import { PaymentLinkModule } from "./modules/payment-link/payment-link.module";
import { NotificationModule } from "./modules/notification/notification.module";
import { CartModule } from "./modules/cart/cart.module";
import { OnboardingModule } from "./modules/onboarding/onboarding.module";
import { BookingModule } from "./modules/booking/booking.module";
import { AiExtractionModule } from "./modules/ai-extraction/ai-extraction.module";
import { FinanceModule } from "./modules/finance/finance.module";
import { QuotationsModule } from "./modules/quotations/quotations.module";
import { RequestLogModule } from "./modules/request-log/request-log.module";
import { QrPageModule } from "./modules/qr-page/qr-page.module";
import { TestModule } from "./modules/test/test.module";
import { winstonConfig } from "./modules/logger/winston.config";
import { TraceIdMiddleware } from "./common/middleware/trace-id.middleware";

@Module({
  imports: [
    // Config — carga el .env a process.env ANTES que cualquier otro módulo.
    // isGlobal: true → disponible en toda la app sin re-importarlo.
    // envFilePath: el .env vive en la raíz del monorepo (compartido entre apps).
    // `pnpm --filter=api dev` arranca con cwd = apps/api/ → subimos 2 niveles.
    // Fallback a `.env` local por si alguna vez se corre desde la raíz.
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ["../../.env", ".env"],
    }),

    // Logger global — disponible en toda la app
    WinstonModule.forRoot(winstonConfig),

    // Rate limiting — UN SOLO bucket global "default".
    //
    // OJO con el comportamiento de @nestjs/throttler v5: si declarás varios
    // buckets nombrados en `forRoot`, TODOS aplican a TODOS los endpoints
    // simultáneamente (cada uno con su propio contador por IP), y el más
    // restrictivo gana. Es por eso que tener `default: 30/min` activo en
    // paralelo con `relaxed: 120/min` no servía: el endpoint igual rebotaba
    // a las 30 req/min del default.
    //
    // Solución: un único bucket global generoso (120/min). Los endpoints
    // que necesitan ser más restrictivos lo sobrescriben con
    // `@Throttle({ default: { ttl, limit } })` (login, uploads, etc.).
    //
    // Render está detrás de un proxy: en `main.ts` configuramos
    // `app.set('trust proxy', 1)` para que el throttler vea la IP real
    // del cliente (no la del proxy de Render).
    ThrottlerModule.forRoot([{ name: "default", ttl: 60_000, limit: 120 }]),

    // MongoDB
    MongooseModule.forRoot(process.env.MONGODB_URI!, {
      connectionFactory: (connection) => {
        connection.on("connected", () =>
          console.log("[MongoDB] Conexión establecida"),
        );
        connection.on("disconnected", () =>
          console.error("[MongoDB] Conexión perdida"),
        );
        connection.on("error", (err: Error) =>
          console.error("[MongoDB] Error de conexión:", err.message),
        );
        return connection;
      },
    }),

    LoggerModule,
    HealthModule,
    AuthModule,
    TenantModule,
    MenuModule,
    PaymentModule,
    OrderModule,
    AnalyticsModule,
    GatewayModule,
    BcvRateModule,
    PushModule,
    PaymentLinkModule, // P1.15 — Web Push notifications para cliente final
    NotificationModule, // P2.2 — WhatsApp UltraMsg notificaciones al cliente
    CartModule, // P2.3 — persistencia de carrito en Redis (TTL 2h)
    OnboardingModule, // P2.4 — Wizard de onboarding de tenant con templates
    BookingModule, // M3 — Booking archetype (peluquerías, spas, citas)
    AiExtractionModule, // M7 — Extracción de datos con IA (reemplaza Tesseract OCR)
    FinanceModule, // M8 — Gestión de documentos financieros (ingresos/egresos)
    QuotationsModule, // M9 — Generador de cotizaciones PDF
    RequestLogModule, // Historial de requests fallidos con TTL 30 días
    QrPageModule, // QR Pages — páginas de cobro permanentes con QR estático (estándar todos los planes)
    TestModule, // M6 — helpers de test (POST /test/reset, bloqueado en prod)
  ],
  providers: [
    // ThrottlerGuard como guard global — corre antes que JwtAuthGuard así
    // un atacante sin token tampoco puede hacer flood. WS no se ve afectado
    // (ThrottlerGuard sólo intercepta HTTP).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  // TraceIdMiddleware aplica a toda la API — genera/propaga x-trace-id y deja
  // req.traceId disponible para los interceptors, decorators y servicios.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceIdMiddleware).forRoutes("*");
  }
}
