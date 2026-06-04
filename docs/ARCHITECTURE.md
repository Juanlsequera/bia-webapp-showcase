# Visión General de Arquitectura

## Forma del Producto

Bia es una plataforma SaaS white-label donde cada tenant puede operar un arquetipo de negocio diferente desde la misma base de código:

- Food: pedidos QR en mesa, takeaway, confirmación de pago, panel de cocina.
- Retail: catálogo de productos, variantes, compras con control de stock.
- Booking: calendarios de staff, reservas, flujos de reprogramación/cancelación.
- Services: solicitudes de clientes, armado de cotizaciones, aprobación y ejecución.

## Backend

El backend sigue una organización por módulos de dominio en NestJS. Cada módulo es dueño de su capa de controladores/handlers, DTOs, lógica de servicio, schema de persistencia y providers de integración cuando corresponde.

Módulos representativos incluidos en este showcase:

- `ai-extraction`: extracción asistida por LLM para documentos financieros, facturas de proveedores, comprobantes de PagoMóvil, comprobantes de transferencia y comprobantes estilo Zelle.
- `analytics`: métricas operativas a partir de datos reales de tenants, incluyendo ingresos, rendimiento de productos y patrones de reporting para admin.
- `auth`: login JWT, roles, refresh tokens, flujo de reset de contraseña, gestión de usuarios.
- `order`: schema de orden unificado, transiciones de estado, snapshots de pago, scope por tenant.
- `payment`: registros de transacciones de pago, cierre de caja admin, operaciones de export/CSV.
- `booking`: disponibilidad de staff, reservas por fecha, operaciones de reprogramación/cancelación.
- `onboarding`: configuración de tenant, templates por arquetipo, setup inicial.
- `gateway`: rooms de Socket.IO con scope por tenant, rol y contexto de mesa/orden.

## Modelo de Datos

Se usa MongoDB/Mongoose porque la plataforma es multi-tenant y multi-arquetipo. Un restaurante, una tienda retail, un negocio de reservas y un negocio de servicios no necesitan exactamente los mismos campos, estados de ciclo de vida ni metadata operativa.

En lugar de crear muchas tablas SQL rígidas para cada variación por vertical, el producto usa documentos con scope por tenant, contratos TypeScript compartidos, validación de schema y campos discriminadores como la configuración de arquetipo/módulos. Esto mantiene el dominio flexible sin resignar invariantes importantes que se enforcea en servicios y DTOs.

## Frontend

El frontend es una app React + TypeScript con experiencias separadas para los flujos del cliente final, el admin del tenant y el staff operativo.

Áreas representativas incluidas:

- Catálogo del cliente y flujos de booking/servicios.
- Dashboard de admin, productos, órdenes, analytics, configuración, staff y agenda.
- Panel operativo de cocina.
- Componentes UI compartidos y clientes de API.

## Reglas Multi-Tenant

- Las operaciones de admin y staff derivan el `tenantId` del contexto JWT.
- Los tenant IDs provistos por el cliente no son confiables para escrituras privilegiadas.
- Los flujos públicos del cliente final resuelven tenants por slug y solo exponen datos públicos.
- Los tipos compartidos mantienen alineados los contratos de API entre backend y frontend.
- Los feature flags y toggles de módulos permiten que cada tenant exponga solo las capacidades habilitadas para su plan/arquetipo.

## Operaciones en Tiempo Real

El módulo `gateway` usa rooms de Socket.IO con scope por tenant y contexto de flujo. Esto permite que la app pushee cambios de estado de órdenes/pagos a las pantallas de cocina, dashboards de admin y vistas de estado de pedido del cliente, sin necesidad de polling.

Los eventos llevan payloads con trace ID para poder seguir un problema operativo desde el request HTTP hasta el registro en base de datos y la emisión WebSocket.

## IA y Extracción de Documentos

El módulo de extracción separa providers, schemas, prompts y extractors. Esto permite procesar imágenes o documentos como comprobantes de PagoMóvil, proofs de transferencia, comprobantes Zelle y facturas de proveedores usando providers LLM detrás de una interfaz consistente.

El objetivo no es confiar ciegamente en el output del modelo. Los resultados de extracción se normalizan en schemas tipados para que los flujos de pago/finanzas downstream puedan validarlos y revisarlos.

## Analytics

Los analytics se derivan de datos operativos reales en lugar de métricas mock estáticas. Las vistas de admin pueden resumir ingresos, órdenes, flujos de pago, rendimiento de productos y actividad en series de tiempo para cada tenant.

## Patrones de Confiabilidad

- La lógica de negocio se mantiene fuera de los controladores.
- Los registros de pago están orientados a auditoría y son compatibles con procesamiento idempotente.
- Los datos de tasa de cambio y carrito usan estrategias de caché con fallback.
- Los payloads WebSocket incluyen datos de trace para depuración operativa.
- JWT, guards y verificaciones de roles protegen las rutas de admin/staff.
- Los trace IDs se propagan a través del request handling para soportar depuración en producción.
