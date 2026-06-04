/**
 * PoweredByBia — badge sutil que aparece al pie de todas las páginas
 * cliente (menú, carrito, estado de orden, reservas).
 *
 * Propósito doble:
 *   1. Brand awareness: backlink natural hacia biaapp.com
 *   2. SEO: cada instancia de tenant genera un link hacia la landing
 *
 * El diseño es intencionalmente discreto para no competir con la identidad
 * del tenant, pero sí visible en desktop y en scroll largo mobile.
 */
export function PoweredByBia() {
  return (
    <div className="flex justify-center items-center py-6 mt-2">
      <a
        href="https://biaapp.ve"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-muted/60 hover:text-muted transition-colors group"
        aria-label="Plataforma BIA APP"
      >
        <span>Impulsado por</span>
        <span className="font-semibold text-muted/80 group-hover:text-primary transition-colors">
          BIA APP
        </span>
        <span className="opacity-40 group-hover:opacity-70 transition-opacity">
          ↗
        </span>
      </a>
    </div>
  );
}
