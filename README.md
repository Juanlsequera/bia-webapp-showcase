# Bia Webapp Showcase

Versión curada para portfolio de una plataforma SaaS multi-tenant para pequeños negocios en Latinoamérica. El producto privado soporta múltiples arquetipos de negocio desde la misma base de código: pedidos de comida, catálogo retail, negocios basados en reservas y cotizaciones de servicios.

Este repositorio no es un volcado completo del producto en producción. Contiene extractos de código seleccionados que demuestran arquitectura, diseño de backend, flujos de frontend, tests y decisiones de ingeniería, sin exponer credenciales de producción, runbooks operativos, detalles de roadmap privado ni la implementación comercial completa.

## Qué muestra este repositorio

- Arquitectura de backend con módulos NestJS, controladores, servicios, DTOs, guards, schemas, WebSockets y límites de integración.
- Modelado de dominio multi-tenant con MongoDB/Mongoose, acceso a datos por tenant, entidades flexibles según arquetipo y autorización JWT basada en roles.
- Flujos orientados a pagos con registros de transacciones auditables y operaciones asíncronas cliente/admin.
- Operaciones en tiempo real con rooms de Socket.IO para actualizaciones de cocina, admin y cliente final.
- Extracción de documentos asistida por LLM para facturas y comprobantes de pago, incluyendo procesamiento de imágenes de PagoMóvil.
- Patrones de observabilidad en producción: trace IDs propagados a través de HTTP, logs, registros de base de datos y eventos WebSocket.
- Feature flags y toggles de módulos para habilitar o deshabilitar capacidades por tenant sin ramificar el código.
- Endpoints y pantallas de analytics construidos sobre datos operativos reales.
- Manejo de estados de reservas y pedidos con tests sobre reglas de negocio.
- Experiencias de admin y cliente en React + TypeScript con layouts por ruta, UI reutilizable y clientes de API.
- Ejemplos de testing end-to-end con Playwright.

## Stack

- Monorepo: Turborepo + pnpm workspaces
- Backend: Node.js, NestJS, TypeScript, Mongoose/MongoDB, Redis, Socket.IO
- Frontend: React 18, TypeScript, Vite, Tailwind, React Query, Zustand
- Testing: tests de backend con Jest/Supertest y specs E2E con Playwright
- Integraciones representadas en los extractos: pagos, extracción LLM, upload de media, email, push notifications, actualizaciones en tiempo real

## Mapa del repositorio

```text
source-excerpts/
  backend/
    modules/
      ai-extraction/  Providers LLM y extracción de documentos/comprobantes
      auth/           Auth JWT, roles, flujo de reset, refresh tokens
      analytics/      Métricas sobre datos reales y reporting para admin
      booking/        Disponibilidad de staff, reservas, reprogramación/cancelación
      order/          Modelo de orden unificado y transiciones de estado
      payment/        Transacciones de pago y cierre de caja admin
      payment-link/   Links de pago compartibles
      bcv-rate/       Caché y fallback de tasa de cambio BCV
      gateway/        Rooms Socket.IO por tenant y eventos trazados
      onboarding/     Configuración de tenant y templates por arquetipo
    common/           Middleware, decoradores y helpers compartidos de NestJS
  frontend/
    pages/            Flujos seleccionados de admin, cliente, cocina, reservas y servicios
    components/       Componentes UI/layout reutilizables
    lib/              Clientes de API, formateo de dinero, tours y helpers
  shared/
    types/            Interfaces TypeScript compartidas
tests/
  backend/            Specs representativos de unidad/reglas de negocio
  e2e/                Specs Playwright para flujos de cliente/admin
docs/
  ARCHITECTURE.md
  SECURITY.md
  RECRUITER_GUIDE.md
```

## Decisiones de diseño

- Los controladores se mantienen delgados; la lógica de negocio vive en los servicios.
- Los módulos están organizados por responsabilidad de dominio, no por capa técnica.
- El aislamiento entre tenants se implementa en el servidor desde el contexto JWT, no desde IDs provistas por el cliente.
- Se usa MongoDB para soportar documentos multi-tenant y multi-arquetipo sin multiplicar tablas SQL rígidas por cada variante del negocio.
- Los flujos de pago y orden preservan snapshots inmutables de precios/pagos para garantizar auditabilidad.
- Los mensajes WebSocket incluyen trace IDs para depurar flujos distribuidos y mantener sincronizadas las pantallas operativas.
- Los feature flags/toggles de módulos permiten habilitar o deshabilitar capacidades por tenant de forma segura.
- La extracción LLM se trata como un boundary de integración, con providers y extractors separados de los controladores.
- La UI está dividida entre flujos del cliente final, admin del tenant, operaciones de cocina/staff y conceptos de superadmin.

## Ejecutar el producto completo

Este showcase no está pensado para ejecutarse como el producto SaaS completo. Algunos módulos, archivos de deploy, credenciales, documentación interna y lógica comercial están omitidos intencionalmente.

Para entrevistas, puedo recorrer el repositorio privado en vivo, explicar decisiones de implementación y discutir tradeoffs sobre multi-tenancy, pagos, auth, actualizaciones en tiempo real y arquitectura de frontend.

## Aviso de portfolio

Este repositorio se publica únicamente para revisión de portfolio y reclutamiento.

No se permite el uso comercial, redistribución, reventa ni reutilización del código fuente sin permiso escrito explícito del autor.

La configuración sensible, credenciales, datos de producción, detalles de deploy y lógica de negocio seleccionada han sido removidos o simplificados.
