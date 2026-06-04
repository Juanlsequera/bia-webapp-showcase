# Notas de Seguridad y Privacidad

Este repositorio público fue sanitizado intencionalmente.

## Removido u Omitido

- Archivos `.env` reales.
- Configuración de deploy en producción.
- Valores de secrets y credenciales de providers.
- Runbooks operativos privados.
- Datos de clientes/tenants.
- Roadmap comercial completo.
- Automatizaciones internas e instrucciones de agentes IA seleccionadas.

## Prácticas Demostradas en los Extractos

- Autorización basada en roles con JWT.
- Aislamiento de tenants desde el contexto autenticado.
- Guards y decoradores para rutas protegidas.
- DTOs de validación en requests entrantes.
- Flujo de reset de contraseña diseñado para evitar enumeración de cuentas.
- Patrones de flujo de webhooks/pagos compatibles con procesamiento idempotente.
- Contexto de trace server-side para depuración.

## Si Clonás Este Repositorio

No agregues credenciales reales a este repositorio. Usá `.env.example` únicamente como placeholder local y mantené los secrets reales fuera de Git.
