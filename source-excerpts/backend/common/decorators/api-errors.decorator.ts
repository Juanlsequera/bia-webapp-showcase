import { applyDecorators } from "@nestjs/common";
import { ApiResponse } from "@nestjs/swagger";

/**
 * Decoradores reutilizables para documentar los errores típicos de la API.
 *
 * El formato del body de error está estandarizado por `HttpExceptionFilter`
 * en `common/filters`, así que lo documentamos acá una sola vez y lo referenciamos
 * desde cada endpoint que corresponda.
 *
 * Forma del body (ver HttpExceptionFilter):
 * ```json
 * {
 *   "statusCode": 400,
 *   "message": "descripción del error",
 *   "error": "Bad Request",
 *   "path": "/ruta/afectada",
 *   "timestamp": "2026-04-20T..."
 * }
 * ```
 */

/** 400 de `ValidationPipe` cuando un DTO o query param no pasa validación. */
export const ApiValidationError = () =>
  ApiResponse({
    status: 400,
    description:
      "Payload o query params inválidos — falla la validación del DTO " +
      "(campos faltantes, tipos incorrectos, o valores fuera de rango).",
  });

/** Conjunto clásico de errores de auth: 401 (no token / inválido) + 403 (rol insuficiente). */
export const ApiAuthErrors = () =>
  applyDecorators(
    ApiResponse({
      status: 401,
      description: "Token JWT ausente, inválido o expirado.",
    }),
    ApiResponse({
      status: 403,
      description:
        "El token es válido pero el rol no tiene permiso para este endpoint " +
        "(ej: kitchen intentando verificar PagoMóvil).",
    }),
  );

/** 403 específico del guard multi-tenant — el recurso pertenece a otro negocio. */
export const ApiTenantForbidden = () =>
  ApiResponse({
    status: 403,
    description:
      "El recurso pertenece a otro tenant. El guard multi-tenant bloquea el acceso " +
      "aunque el JWT sea válido.",
  });

/** 404 genérico — recurso no encontrado por id. */
export const ApiNotFound = (resource = "El recurso") =>
  ApiResponse({
    status: 404,
    description: `${resource} no existe o fue borrado.`,
  });

/** 409 — conflicto (ej: email ya usado, slug ya tomado). */
export const ApiConflict = (
  description = "Conflicto con el estado actual del recurso.",
) => ApiResponse({ status: 409, description });
