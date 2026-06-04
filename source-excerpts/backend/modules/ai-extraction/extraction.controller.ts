import {
  Controller,
  Post,
  Param,
  Body,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
  PayloadTooLargeException,
  UnauthorizedException,
  Req,
  UseGuards,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Throttle } from "@nestjs/throttler";
import {
  ApiTags,
  ApiOperation,
  ApiConsumes,
  ApiParam,
  ApiResponse,
  ApiBearerAuth,
  ApiBody,
} from "@nestjs/swagger";
import { Request } from "express";
import { ExtractionService } from "./extraction.service";
import { ExtractorFactory } from "./core/extractor.factory";
import { OptionalJwtGuard } from "../auth/guards/optional-jwt.guard";
import type { AuthUser } from "@foodorder/types";

/**
 * POST /:tenantSlug/extract/:type
 *
 * Endpoint público por defecto. Si el extractor tiene requiresAuth=true,
 * verifica que haya un JWT válido en el request.
 *
 * JwtAuthGuard NO se aplica globalmente acá para permitir que el cliente
 * final use pagomovil-receipt sin loguearse.
 * La autenticación de la petición la verifica manualmente si requiresAuth=true.
 */
@ApiTags("AI Extraction")
@Controller()
export class ExtractionController {
  constructor(
    private readonly service: ExtractionService,
    private readonly factory: ExtractorFactory,
  ) {}

  @Post(":tenantSlug/extract/:type")
  @UseGuards(OptionalJwtGuard)
  @UseInterceptors(FileInterceptor("image"))
  @Throttle({ default: { ttl: 60_000, limit: 20 } }) // 20 extracciones/min por IP
  @ApiConsumes("multipart/form-data")
  @ApiParam({ name: "tenantSlug", example: "mi-restaurante" })
  @ApiParam({
    name: "type",
    example: "pagomovil-receipt",
    description: "Tipo de extractor registrado",
  })
  @ApiBearerAuth("jwt")
  @ApiOperation({
    summary: "Extraer datos estructurados de una imagen",
    description:
      "Usa un LLM con visión para extraer campos de comprobantes de pago u otros documentos. " +
      "Público para extractores con requiresAuth=false (ej: pagomovil-receipt). " +
      "Requiere JWT para extractores admin (ej: supplier-invoice en el futuro).",
  })
  @ApiResponse({
    status: 200,
    description: "Extracción exitosa",
    schema: {
      example: {
        type: "pagomovil-receipt",
        data: {
          isValidReceipt: true,
          reference: "000756043678",
          amount: 1200.5,
          confidence: "high",
        },
        cached: false,
        provider: "gemini",
        latencyMs: 1245,
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: "Tipo desconocido o imagen inválida",
  })
  @ApiResponse({ status: 413, description: "Imagen demasiado grande" })
  @ApiResponse({
    status: 422,
    description: "El LLM devolvió datos con formato inválido",
  })
  @ApiResponse({
    status: 429,
    description: "Rate limit del provider o por tenant",
  })
  @ApiResponse({ status: 503, description: "Provider LLM no disponible" })
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        image: {
          type: "string",
          format: "binary",
          description: "Imagen del comprobante (PNG, JPG, WEBP — máx 5MB)",
        },
        expectedAmount: {
          type: "number",
          description: "Monto esperado en Bs. (opcional, para sanity check)",
        },
        expectedBeneficiaryPhone: {
          type: "string",
          description: "Teléfono beneficiario esperado (opcional)",
        },
      },
      required: ["image"],
    },
  })
  async extract(
    @Param("tenantSlug") _tenantSlug: string,
    @Param("type") type: string,
    @UploadedFile() image: Express.Multer.File | undefined,
    @Body("expectedAmount") expectedAmountStr?: string,
    @Body("expectedBeneficiaryPhone") expectedBeneficiaryPhone?: string,
    @Req()
    req: Request & { user?: AuthUser } = {} as Request & { user?: AuthUser },
  ) {
    if (!image) {
      throw new BadRequestException(
        'Se requiere un archivo de imagen en el campo "image"',
      );
    }

    // Validar tipo MIME
    const allowedMimes = [
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/gif",
      "image/heic",
    ];
    if (!allowedMimes.includes(image.mimetype)) {
      throw new BadRequestException(
        `Tipo de imagen no soportado: ${image.mimetype}`,
      );
    }

    // Resolver extractor para verificar requiresAuth ANTES de procesar la imagen
    const extractor = this.factory.get(type);

    if (extractor.requiresAuth && !req.user) {
      throw new UnauthorizedException(
        "Este extractor requiere autenticación (JWT)",
      );
    }

    // Validar tamaño
    const maxBytes = extractor.maxImageBytes ?? 5 * 1024 * 1024;
    if (image.buffer.length > maxBytes) {
      throw new PayloadTooLargeException(
        `Imagen demasiado grande: ${(image.buffer.length / 1024 / 1024).toFixed(1)}MB. Máximo: ${(maxBytes / 1024 / 1024).toFixed(0)}MB`,
      );
    }

    const context = {
      tenantId: req.user?.tenantId,
      expectedAmount: expectedAmountStr ? Number(expectedAmountStr) : undefined,
      expectedBeneficiaryPhone: expectedBeneficiaryPhone ?? undefined,
    };

    return this.service.extract(type, image.buffer, image.mimetype, context);
  }
}
