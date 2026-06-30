# Bia Webapp — Showcase de Portfolio

Portfolio técnico curado de [**Biaverse**](https://biaverse.app) (`biaverse.app`), una plataforma SaaS multi-tenant **en producción** para PYMEs en Venezuela y Latinoamérica. El producto real soporta múltiples arquetipos de negocio desde la misma base de código — restaurantes, retail, peluquerías/spas/médicos y técnicos/plomeros — con módulos activables por plan y aislamiento completo entre tenants.

Este repositorio no es un volcado del producto en producción. Contiene extractos de código seleccionados que demuestran arquitectura, decisiones de ingeniería, flujos críticos y patrones de diseño, sin exponer credenciales de producción, runbooks operativos, detalles de roadmap privado ni la implementación comercial completa.

---

## Arquitectura general

```
monorepo (Turborepo + pnpm workspaces)
├── apps/
│   ├── api          NestJS — 24 módulos, Clean Architecture
│   ├── web          React — portal del tenant (admin + cliente)
│   ├── superadmin   React — panel de operaciones de plataforma
│   └── landing      React — sitio público de Biaverse
└── packages/
    ├── types        Interfaces TypeScript compartidas (api ↔ frontend)
    ├── ui           Componentes de diseño reutilizables
    └── config       Configuración compartida (ESLint, TS, Tailwind)
```

**Principios transversales:**

- **Multi-tenant con aislamiento server-side:** el `tenantId` se extrae exclusivamente del JWT; ningún cliente puede proveerlo. Todos los queries de Mongoose lo llevan como filtro implícito.
- **Clean Architecture en 24 módulos NestJS:** controladores delgados, lógica en servicios, boundaries de integración explícitos. Módulos organizados por dominio, no por capa técnica.
- **Multi-arquetipo desde la misma base de código:** `food` (restaurantes/cafés), `retail` (tiendas), `booking` (peluquerías/spas/médicos), `services` (técnicos/plomeros). Una única API sirve a todos sin bifurcación del código.
- **Módulos activables por plan:** Starter / Pro / Enterprise. Los feature flags se evalúan server-side; no hay lógica de plan en el cliente.
- **RBAC granular:** permisos por `recurso:acción`, roles editables por el propio tenant, modo discreto (`hideMonetaryTotals`) aplicado como `MonetaryMaskInterceptor` server-side.
- **Snapshots inmutables de precio:** cada `Order` congela `total_usd`, `usd_rate`, `total_bs`, `rate_captured_at`, `distance_km`, `delivery_fee_usd` en el momento de creación. Los datos históricos no se ven afectados por cambios de catálogo o tasa.
- **TraceId full-stack:** propagado en HTTP headers, logs Winston, payloads WebSocket y documentos `Order`/`PaymentTransaction`. Permite rastrear cualquier flujo distribuido desde el log hasta la base de datos.

---

## Stack tecnológico

### Backend — NestJS API

| Categoría | Tecnologías |
|---|---|
| Runtime | Node.js 20, NestJS 10, TypeScript |
| Auth | Passport + passport-jwt, JWT con access (2 h) + refresh (30 d) y rotación de tokens |
| Base de datos | MongoDB Atlas + Mongoose 8 |
| Caché / sesiones | Redis (Upstash) — caché L2, sesiones, pub/sub, JWT blacklist |
| Tiempo real | Socket.io 4.7 — WebSockets bidireccionales por rooms de tenant |
| Tareas programadas | NestJS Schedule (cron jobs) |
| Rate limiting | NestJS Throttler — 120/min global, 5/15 min en auth |
| Validación | Zod, class-validator, class-transformer |
| Documentación | Swagger / OpenAPI |
| Seguridad | Helmet, bcrypt, timing-safe anti-enumeration |
| Exportes | ExcelJS (CSV/Excel), jsPDF (PDFs) |
| Push admin | web-push con VAPID |
| Logging | Winston con traceId estructurado |
| Testing | Jest 30 + Supertest |

### Frontend — React (web · superadmin · landing)

| Categoría | Tecnologías |
|---|---|
| Core | React 18.3, TypeScript, Vite |
| Estilos | TailwindCSS |
| Server state | TanStack Query v5 (React Query) |
| UI state | Zustand |
| Formularios | React Hook Form |
| Tiempo real | Socket.io-client |
| Routing | React Router DOM v6 |
| Gráficos | Recharts |
| Mapas | Leaflet + React Leaflet (delivery) |
| Animaciones | Framer Motion |
| PDFs en cliente | jsPDF + jspdf-autotable |
| Iconos | Lucide React |
| Testing | Vitest + Testing Library, Playwright (E2E) |

### Integraciones externas

| Servicio | Uso |
|---|---|
| **Twilio** | SMS / WhatsApp — 13 eventos de notificación al cliente final |
| **Resend** | Email transaccional (confirmaciones, recordatorios, billing) |
| **Cloudinary** | Media — comprobantes de pago, imágenes de productos |
| **Anthropic (Claude Vision)** | OCR de comprobantes PagoMóvil y facturas; re-OCR server-side anti-fraude |

### DevOps

| Componente | Detalle |
|---|---|
| **CI/CD** | GitHub Actions — `ci.yml` (tests + lint), `deploy.yml`, `keepalive.yml` |
| **Frontend** | Vercel × 3 (web · superadmin · landing) |
| **API** | Render (con keepalive activo en el plan gratuito) |
| **Local** | Docker Compose — MongoDB + Redis + Mongo Express |
| **Dominio** | `biaverse.app` con DNS personalizado |

---

## Features implementadas (todas en producción)

### Cobro y pagos

- **PagoMóvil verificado por IA:** OCR con Claude Vision + re-OCR server-side para detección de fraude; auto-aprobación con topes configurables y gate de referencia única (índice único parcial MongoDB para imposibilitar la reutilización del mismo comprobante).
- **Métodos múltiples:** Zelle, Binance Pay, transferencia bancaria, efectivo (Bs y USD).
- **Payment Links:** links de pago compartibles por WhatsApp con flujo público asíncrono; el cliente paga sin necesidad de cuenta.
- **Abonos/señas parciales:** soportado en cualquier orden, con trazabilidad por transacción.
- **Reembolsos con CAS:** Compare-And-Swap condicional en MongoDB para evitar doble egreso bajo concurrencia.
- **Cierre de caja:** arqueo completo + export CSV con filtros por método/turno.
- **QR Pages (4 variantes):** monto fijo, monto libre *(Starter)*; mostrador con carrito armado por el admin, autoservicio con catálogo público *(Pro)*.

### Notificaciones al cliente

- **Twilio SMS / WhatsApp:** canal configurable por variable de entorno (`NOTIFY_CHANNEL`). 13 eventos: pago aprobado/rechazado, pedido listo, reserva confirmada/recordatorio/reprogramada/cancelada, cotización enviada, link de pago creado/pagado/rechazado.
- **Optimización de costo SMS:** encoding GSM-7 garantizado (1 segmento = 160 chars), solo eventos críticos en SMS; WhatsApp sin restricción de longitud.
- **Normalización E.164:** teléfonos venezolanos locales normalizados automáticamente a `+58...`.
- **Web Push VAPID:** notificaciones al admin del tenant aunque el panel esté cerrado (nueva venta, pago pendiente, etc.).
- **Resumen semanal por WhatsApp:** cron lunes con métricas de la semana *(Pro)*.
- **Kill-switch `NOTIFY_DISABLED`:** deshabilita todos los envíos para tests y entornos E2E.

### Inventario

- **Decremento atómico anti-oversell:** `findOneAndUpdate` condicional; el stock nunca llega a negativo bajo carga concurrente.
- **Stock por variante + top-level:** soporte para productos simples y multi-variante.
- **Venta al peso:** flag `sold_by_weight` — `price` en precio/kg, stock en kg (decimal). Decremento con `Math.round(q*1000)/1000` para evitar floating-point drift. Escalones configurables para flujo online; mostrador sin restricción.
- **Stock movements:** log inmutable de cada movimiento (audit trail completo).
- **Ajuste manual y reposición** via endpoint de admin.
- **Lookup por SKU** para escaneo de etiquetas en mostrador.

### Finanzas *(Pro)*

- Documentos financieros con `amount_usd` snapshot inmutable y COGS automático.
- **OCR de facturas** con Claude Vision.
- IVA / IGTF, ganancia cambiaria, cuentas por cobrar y pagar.
- **Conciliación bancaria v2:** import OCR del estado de cuenta, matching difuso por monto+fecha, write-back de estado. Auto-confirma solo con referencia bancaria exacta; matches aproximados requieren confirmación humana.

### Delivery

- **Cálculo haversine server-side** (sin API de mapas ni costos externos).
- Costo por tramos configurables (tiers por km).
- **Anti-fraude GPS:** pin obligatorio del cliente + verificación de GPS del dispositivo; divergencia por encima del umbral → revisión manual.
- **Link del repartidor:** mapa origen + destino con Leaflet + OpenStreetMap, compartible por WhatsApp.
- Snapshot inmutable: `distance_km`, `delivery_tier_km`, `delivery_fee_usd` en `Order.pricing`.

### Cotizaciones *(arquetipo services)*

- **Flujo A:** PDF independiente (`quotation_builder`) con aprobación offline.
- **Flujo B:** cotización embebida en `Order` con link de aprobación online para el cliente.
- Re-cotización permitida (`quoted → quoted`) sobre la misma orden.
- CAS sobre `status` para evitar race conditions en transiciones concurrentes.

### Analíticas

- Dashboard: summary, top productos, revenue por día, métodos de pago, desglose por categoría.
- Staff performance, clientes frecuentes, hora pico, ingeniería de menú *(Pro)*.
- Búsqueda de orden por sufijo (6 chars) o `ObjectId` completo.
- Export CSV; `MonetaryMaskInterceptor` para roles con `hideMonetaryTotals` *(modo discreto server-side)*.

### Sistema de suscripción y billing

- **Renovación automática:** cron diario con ventanas T-5/T-3/T-0.
- Generación automática de `PaymentLink` de cobro hacia BIA.
- Notificación al admin del tenant (email + SMS/WhatsApp al `billing_phone`).
- Aprobación manual del superadmin con extensión de `paid_until`.
- **Idempotencia por ciclo:** índice único parcial en MongoDB; el cron nunca genera duplicados.

### Tasa BCV

- Caché dual Redis: `current` (TTL 1 h) + `last-known` (TTL 7 d).
- Fallback en cadena; bloquea la creación de órdenes si no hay tasa válida.
- Snapshot inmutable en cada `Order`: `total_usd`, `usd_rate`, `total_bs`, `rate_captured_at`.

### Seguridad y observabilidad

- **TraceId** propagado en HTTP headers (`X-Trace-Id`), logs Winston, payloads WebSocket y documentos de base de datos.
- **Anti-enumeración en auth:** bcrypt dummy para usuarios inexistentes, `timingSafeEqual`, respuesta `200` siempre en `forgot-password`.
- **Rate limiting:** `ThrottlerGuard` — 120/min global, 5 intentos/15 min en endpoints de auth.
- **JWT blacklist en Redis:** `fail-open` si Redis cae (disponibilidad > seguridad en ese escenario). Access TTL 2 h + refresh 30 d con rotación y detección de reutilización de tokens.
- **Índice único parcial** en `pagomovil_reference`: imposible reutilizar el mismo comprobante en dos pedidos.

### Costos de plataforma *(solo superadmin)*

- Registro inmutable de costos Twilio + LLM en `platform_usage_events` (TTL 180 d).
- Fire-and-forget: nunca bloquea la operación principal.
- Dashboard superadmin: costos totales, tendencia, desglose por tenant.
- Tarifa SMS Venezuela: `$0.2258/segmento` (dato real de Twilio).

---

## Planes y módulos

| Módulo / Feature | Starter | Pro | Enterprise |
|---|:---:|:---:|:---:|
| Pedidos y pagos base | ✓ | ✓ | ✓ |
| QR monto fijo / libre | ✓ | ✓ | ✓ |
| Notificaciones Twilio (SMS/WhatsApp) | ✓ | ✓ | ✓ |
| Web Push VAPID | ✓ | ✓ | ✓ |
| Inventario con stock movements | ✓ | ✓ | ✓ |
| Tasa BCV automática | ✓ | ✓ | ✓ |
| Delivery con haversine + anti-fraude | ✓ | ✓ | ✓ |
| QR mostrador y autoservicio | — | ✓ | ✓ |
| Analytics avanzados (staff, menú, hora pico) | — | ✓ | ✓ |
| Finanzas (conciliación, OCR facturas, COGS) | — | ✓ | ✓ |
| Resumen semanal WhatsApp | — | ✓ | ✓ |
| Venta al peso | — | ✓ | ✓ |
| RBAC con roles editables por tenant | — | ✓ | ✓ |
| Multi-sucursal / configuración avanzada | — | — | ✓ |

---

## Mapa del repositorio

```text
source-excerpts/
  backend/
    modules/
      ai-extraction/     Providers LLM y extracción de documentos/comprobantes (Claude Vision)
      auth/              Auth JWT, roles, flujo de reset, refresh tokens con rotación
      analytics/         Métricas sobre datos reales, reporting y modo discreto server-side
      booking/           Disponibilidad de staff, reservas, reprogramación/cancelación
      order/             Modelo de orden unificado y transiciones de estado con CAS
      payment/           Transacciones de pago, cierre de caja, reembolsos con CAS
      payment-link/      Links de pago compartibles — flujo público asíncrono
      bcv-rate/          Caché dual Redis y fallback de tasa BCV
      delivery/          Haversine, tiers por km, anti-fraude GPS, link repartidor
      inventory/         Decremento atómico, venta al peso, stock movements, SKU lookup
      finance/           Conciliación bancaria v2, OCR facturas, COGS, IVA/IGTF
      subscription/      Cron de renovación, PaymentLink de billing, idempotencia por ciclo
      notification/      Twilio SMS/WhatsApp, 13 eventos, E.164, kill-switch
      gateway/           Rooms Socket.IO por tenant, eventos con traceId
      onboarding/        Configuración de tenant, templates por arquetipo
      platform-usage/    Registro de costos Twilio + LLM, TTL 180 d
    common/              Middleware, decoradores, guards, interceptors (TraceId, MonetaryMask)
  frontend/
    pages/               Flujos seleccionados: admin, cliente, cocina, reservas, servicios
    components/          Componentes UI/layout reutilizables
    lib/                 Clientes de API, formateo de dinero, tours, helpers
  shared/
    types/               Interfaces TypeScript compartidas (api ↔ frontend)
tests/
  backend/               Specs representativos de unidad y reglas de negocio (Jest)
  e2e/                   Specs Playwright para flujos de cliente/admin
docs/
  ARCHITECTURE.md
  SECURITY.md
  RECRUITER_GUIDE.md
```

---

## Ejecutar el producto completo

Este showcase no está pensado para ejecutarse como el producto SaaS completo. Credenciales, archivos de deploy, documentación interna y lógica comercial están omitidos intencionalmente.

Para entrevistas técnicas puedo recorrer el repositorio privado en vivo, explicar decisiones de implementación y discutir tradeoffs sobre multi-tenancy, pagos con verificación por IA, auth, actualizaciones en tiempo real, RBAC, arquitectura de frontend y estrategias de coste operativo.

---

## Aviso de portfolio

Este repositorio se publica únicamente para revisión de portfolio y reclutamiento técnico.

No se permite el uso comercial, redistribución, reventa ni reutilización del código fuente sin permiso escrito explícito del autor.

La configuración sensible, credenciales de producción, datos de clientes, detalles de deploy y partes seleccionadas de la lógica de negocio han sido removidos o simplificados deliberadamente.
