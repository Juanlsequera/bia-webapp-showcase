import { NestFactory } from "@nestjs/core";
import { ValidationPipe } from "@nestjs/common";
import { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import helmet from "helmet";
import express from "express";
import { AppModule } from "./app.module";
import { HttpExceptionFilter } from "./common/filters/http-exception.filter";
import { LoggingInterceptor } from "./common/interceptors/logging.interceptor";
import { AppLogger } from "./modules/logger/logger.service";
import { RequestLogService } from "./modules/request-log/request-log.service";
import { WINSTON_MODULE_NEST_PROVIDER } from "nest-winston";

/** Límite de body para JSON y urlencoded. Default Express es 100KB, queda
 *  chico para órdenes grandes (carrito con muchos items + TenantConfig
 *  patches). 1MB es generoso y bloquea payload bombs. Configurable por
 *  env si algún tenant necesita más (ej. importar catálogo). Multipart
 *  (imágenes) usa multer con su propio limit por endpoint, ver
 *  FileInterceptor en menu/order/tenant controllers. */
const BODY_LIMIT = process.env.MAX_REQUEST_BODY_SIZE ?? "1mb";

async function bootstrap(): Promise<void> {
  // Seguridad: no arrancar con JWT_SECRET inseguro
  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (
    !jwtSecret ||
    jwtSecret === "CAMBIAR_EN_PRODUCCION" ||
    jwtSecret.length < 32
  ) {
    console.error(
      "❌ FATAL: JWT_SECRET no configurado o inseguro. " +
        "Generá uno con: openssl rand -base64 64",
    );
    process.exit(1);
  }

  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    // bodyParser: false desactiva el body-parser default de NestJS (100KB
    // hardcoded) para que podamos registrar uno con el límite que queremos.
    // Sin esto, `app.use(express.json({ limit }))` no surte efecto porque
    // el default ya está procesando el body antes.
    { bufferLogs: true, bodyParser: false },
  );

  // En prod estamos detrás del proxy de Render. Sin esto, `req.ip` es la
  // IP del proxy y el ThrottlerGuard rate-limita a TODOS los clientes como
  // si fueran uno solo. `'trust proxy', 1` confía sólo en el primer hop
  // (el proxy más cercano) — más seguro que `true` que confía en TODOS los
  // X-Forwarded-For (un cliente malicioso podría falsificar su IP).
  app.set("trust proxy", 1);

  // Body parsers con límite explícito (default Express es 100KB). Protección
  // anti payload-bomb. Aplican solo a application/json y x-www-form-urlencoded;
  // los uploads de imágenes van por multipart/form-data manejado por multer
  // con sus propios límites por endpoint (3-5MB cada uno).
  app.use(express.json({ limit: BODY_LIMIT }));
  app.use(express.urlencoded({ limit: BODY_LIMIT, extended: true }));

  // Helmet — cabeceras HTTP de seguridad (XSS, clickjacking, MIME sniffing, etc.)
  // Debe ir antes que CORS y cualquier middleware de rutas.
  // crossOriginResourcePolicy: false para que Cloudinary sirva imágenes cross-origin.
  app.use(helmet({ crossOriginResourcePolicy: false }));

  const logger = app.get<AppLogger>(AppLogger);
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  // Validación global de DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // elimina campos no declarados en el DTO
      forbidNonWhitelisted: true,
      transform: true, // convierte tipos automáticamente
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Filtro global de excepciones — loggea todo lo que rompe y persiste en MongoDB
  const requestLogService = app.get(RequestLogService);
  app.useGlobalFilters(new HttpExceptionFilter(logger, requestLogService));

  // Interceptor global — loggea cada request con tiempo de respuesta
  app.useGlobalInterceptors(new LoggingInterceptor(logger));

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(",") ?? [
      "http://localhost:5173",
    ],
    credentials: true,
    // Exponer x-trace-id al front para que el axios interceptor pueda leerlo
    // (por default los browsers solo dejan ver un set reducido de headers).
    exposedHeaders: ["x-trace-id"],
  });

  // ── Swagger / OpenAPI ────────────────────────────────────────────────
  // UI en GET /api/docs, JSON crudo en GET /api/docs-json.
  // Se puede apagar en prod con ENABLE_SWAGGER=false.
  const swaggerEnabled = process.env.ENABLE_SWAGGER === "true";
  if (swaggerEnabled) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle("BIA API")
      .setDescription(
        "API del SaaS multi-tenant multi-arquetipo. Soporta cuatro verticales: " +
          "**food** (restaurantes, QR de mesa), **retail** (tiendas, catálogo con variantes), " +
          "**booking** (agenda + citas por profesional) y **services** (cotizaciones de servicios técnicos).\n\n" +
          "Las rutas públicas (cliente sin auth) viven bajo `/:tenantSlug/...`. " +
          "Las rutas `/admin/...` requieren JWT con rol `admin`. " +
          "Las rutas `/kitchen/...` requieren JWT con rol `admin` o `kitchen`. " +
          "Las rutas de superadmin requieren JWT con rol `superadmin`.",
      )
      .setVersion("0.1.0")
      .addBearerAuth(
        {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
          description: "JWT emitido por POST /auth/login",
        },
        "jwt",
      )
      .addTag("Auth", "Login y manejo de sesión")
      .addTag("Tenants", "Alta y administración de negocios")
      .addTag("Menu", "Catálogo de productos por tenant")
      .addTag("Cart", "Carrito de compras en Redis (sin auth, por mesa)")
      .addTag("Orders (cliente)", "Rutas públicas que usa el cliente final")
      .addTag("Orders (admin)", "Verificación de PagoMóvil y cobro en efectivo")
      .addTag("Orders (kitchen)", "Panel de cocina — cambio de estado")
      .addTag("Booking", "Staff, disponibilidad y citas (arquetipo booking)")
      .addTag("Payment Links", "Links de pago compartibles por orden")
      .addTag("Payments (admin)", "Cierre de caja — transacciones y export CSV")
      .addTag("Analytics", "Métricas de negocio")
      .addTag("BCV Rate", "Tasa de cambio USD↔Bs del BCV")
      .addTag(
        "Onboarding",
        "Wizard de alta de tenant con templates (superadmin)",
      )
      .addTag("Health", "Probe para Render y uptime monitors")
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup("api/docs", app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
    logger.log("Swagger UI disponible en /api/docs", "Bootstrap");
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`API corriendo en puerto ${port}`, "Bootstrap");
}

bootstrap();
