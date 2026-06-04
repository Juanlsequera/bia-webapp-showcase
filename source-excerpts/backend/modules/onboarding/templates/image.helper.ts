/**
 * Helper para generar URLs deterministas de imágenes desde Unsplash.
 * Source: https://source.unsplash.com → URLs public, sin auth, sin rate limit razonable.
 *
 * Ejemplo:
 *   unsplashImg('pizza') → https://source.unsplash.com/400x300/?pizza
 *   unsplashImg('tshirt', 600, 400) → https://source.unsplash.com/600x400/?tshirt
 *
 * TODO (Post-MVP): Descargar las imágenes de Unsplash y subirlas a Cloudinary
 * bajo foodorder/_templates/{archetype}/{slug}.jpg para mejor performance.
 */
export function unsplashImg(query: string, w = 400, h = 300): string {
  return `https://source.unsplash.com/${w}x${h}/?${encodeURIComponent(query)}`;
}
