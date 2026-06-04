import { Injectable, BadRequestException, PipeTransform } from "@nestjs/common";

/**
 * Valida un slug de tenant antes de que llegue al service y a Mongo.
 *
 * Regla: `^[a-z0-9-]{3,30}$` — minúsculas, dígitos y guiones, 3 a 30 caracteres.
 * Es la misma que aplica el schema de Mongoose (`Tenant.slug`), pero la
 * adelantamos al request: si el path param no cumple, devolvemos 400 sin
 * tocar la base ni la cache. Esto cierra dos huecos:
 *  - Probes/escaneos a `/<slug>/menu` con strings absurdos llegan hasta el
 *    findOne. El pipe los corta antes.
 *  - Inyección de caracteres especiales (espacios, slashes, regex chars) en
 *    rutas públicas.
 */
@Injectable()
export class ParseSlugPipe implements PipeTransform<string, string> {
  private static readonly SLUG_RE = /^[a-z0-9-]{3,30}$/;

  transform(value: string): string {
    if (typeof value !== "string" || !ParseSlugPipe.SLUG_RE.test(value)) {
      throw new BadRequestException(
        "Slug inválido. Debe tener 3-30 caracteres, solo minúsculas, dígitos y guiones.",
      );
    }
    return value;
  }
}
