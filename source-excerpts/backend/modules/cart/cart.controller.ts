import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from "@nestjs/swagger";
import { SkipThrottle } from "@nestjs/throttler";
import { CartService } from "./cart.service";
import { SaveCartDto } from "./dto/cart.dto";

/**
 * CartController — endpoints públicos (sin JWT).
 *
 * El cliente no tiene token; el aislamiento se consigue por tenantId + tableNumber.
 * No es necesario auth porque el carrito no tiene datos sensibles — es solo
 * un array de { productId, qty, notes } que vive 2h en Redis.
 *
 * GET    /:tenantSlug/cart/:tableNumber   → leer carrito
 * POST   /:tenantSlug/cart/:tableNumber   → guardar/reemplazar carrito
 * DELETE /:tenantSlug/cart/:tableNumber   → vaciar carrito
 *
 * tenantId real: lo tomamos de TenantService para no confiar en el body.
 * Por ahora usamos tenantSlug directamente como parte de la key — suficiente
 * para MVP donde el slug es único e inmutable.
 */
@ApiTags("Cart")
@SkipThrottle()
@Controller(":tenantSlug/cart")
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @Get(":tableNumber")
  @ApiOperation({ summary: "Obtener carrito guardado en Redis" })
  @ApiParam({ name: "tenantSlug", description: "Slug del tenant" })
  @ApiParam({
    name: "tableNumber",
    description: 'Número de mesa (o "takeaway")',
  })
  @ApiResponse({
    status: 200,
    description: "Items del carrito ([] si vacío o expirado)",
  })
  getCart(
    @Param("tenantSlug") tenantSlug: string,
    @Param("tableNumber") tableNumber: string,
  ) {
    // Usamos tenantSlug como tenantId en la key — suficiente para MVP
    return this.cartService.getCart(tenantSlug, tableNumber);
  }

  @Post(":tableNumber")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Guardar (reemplazar) carrito en Redis — TTL 2h" })
  @ApiResponse({ status: 200, description: "Carrito guardado." })
  saveCart(
    @Param("tenantSlug") tenantSlug: string,
    @Param("tableNumber") tableNumber: string,
    @Body() dto: SaveCartDto,
  ) {
    return this.cartService.saveCart(tenantSlug, tableNumber, dto);
  }

  @Delete(":tableNumber")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Vaciar carrito (al confirmar pedido o abandonar)" })
  @ApiResponse({ status: 200, description: "Carrito eliminado." })
  clearCart(
    @Param("tenantSlug") tenantSlug: string,
    @Param("tableNumber") tableNumber: string,
  ) {
    return this.cartService.clearCart(tenantSlug, tableNumber);
  }
}
