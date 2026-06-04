# Guía para Reclutadores y Entrevistadores

## Buenos Puntos de Revisión

- Estructura de módulos de backend:
  - `source-excerpts/backend/modules/ai-extraction`
  - `source-excerpts/backend/modules/auth`
  - `source-excerpts/backend/modules/gateway`
  - `source-excerpts/backend/modules/order`
  - `source-excerpts/backend/modules/payment`
  - `source-excerpts/backend/modules/booking`
  - `source-excerpts/backend/common/middleware/trace-id.middleware.ts`

- Arquitectura de frontend:
  - `source-excerpts/frontend/pages/admin`
  - `source-excerpts/frontend/pages/catalog`
  - `source-excerpts/frontend/components/ui`
  - `source-excerpts/frontend/lib/api`

- Tests:
  - `tests/backend/order/order-state-machine.spec.ts`
  - `tests/backend/booking/booking.service.spec.ts`
  - `tests/e2e`

## Temas que Puedo Explicar

- Organización de módulos NestJS y límites de servicio.
- Autorización multi-tenant y aislamiento de datos.
- Por qué MongoDB/Mongoose encaja en esta forma de SaaS: documentos con scope por tenant, multi-arquetipo con campos flexibles.
- Diseño de estados de órdenes y pagos.
- Seguridad JWT, guards, verificación de roles y manejo de refresh tokens.
- Flujos Socket.IO/WebSocket para actualizaciones en tiempo real de cocina, admin y cliente.
- Propagación de trace IDs para seguimiento de requests en producción.
- Feature flags/toggles de módulos para habilitar o deshabilitar capacidades por tenant.
- Extracción asistida por LLM de facturas e imágenes de comprobantes de pago, incluyendo procesamiento de comprobantes PagoMóvil.
- Analytics sobre datos operativos reales.
- Manejo de flujos de pago y operativos asincrónicos.
- Estructura de la UI React para admin/cliente.
- Cobertura de tests E2E con Playwright para los flujos de negocio principales.
- Tradeoffs entre un repo de producto completo y un repo de showcase público.
