import { BadRequestException } from "@nestjs/common";

/**
 * Validación de archivos de imagen subidos por multer.
 *
 * Multer trae `file.mimetype` del header `Content-Type` que envía el cliente —
 * trivialmente falsificable. Un atacante puede subir `malware.exe` con
 * `Content-Type: image/png` y pasar la validación clásica `allowedMimes.includes`.
 *
 * Para defenderse, además del mime declarado validamos los "magic bytes"
 * (primeros bytes del archivo) que sí son el contenido real. Si el cliente
 * miente sobre el mime pero los magic bytes no coinciden con png/jpeg/webp,
 * rechazamos.
 */

const ALLOWED_MIMES = ["image/png", "image/jpeg", "image/webp"] as const;

export function isAllowedImageBuffer(buffer: Buffer | undefined): boolean {
  if (!buffer || buffer.length < 12) return false;

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return true;
  }

  // JPEG: FF D8 FF
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return true;
  }

  // WebP: 'RIFF' (52 49 46 46) + 4 bytes size + 'WEBP' (57 45 42 50)
  if (
    buffer[0] === 0x52 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46 &&
    buffer[3] === 0x46 &&
    buffer[8] === 0x57 &&
    buffer[9] === 0x45 &&
    buffer[10] === 0x42 &&
    buffer[11] === 0x50
  ) {
    return true;
  }

  return false;
}

/**
 * Tira BadRequestException si el archivo no es png/jpeg/webp válido (verificando
 * mime declarado Y magic bytes). Usar al inicio del handler antes de pasar
 * el buffer al MediaService.
 */
export function assertValidImageFile(
  file: Express.Multer.File | undefined,
): void {
  if (!file) {
    throw new BadRequestException('Se requiere un archivo en el campo "file"');
  }
  if (
    !ALLOWED_MIMES.includes(file.mimetype as (typeof ALLOWED_MIMES)[number])
  ) {
    throw new BadRequestException(
      `Tipo de archivo no soportado: ${file.mimetype}. Usar png, jpeg o webp.`,
    );
  }
  if (!isAllowedImageBuffer(file.buffer)) {
    throw new BadRequestException(
      "El archivo no es una imagen válida (magic bytes no coinciden con el tipo declarado).",
    );
  }
}
