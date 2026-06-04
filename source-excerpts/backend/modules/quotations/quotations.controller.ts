import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  BadRequestException,
  ParseIntPipe,
  DefaultValuePipe,
} from "@nestjs/common";
import { ApiTags, ApiOperation, ApiBearerAuth } from "@nestjs/swagger";
import { Request } from "express";
import type { AuthUser } from "@bia/types";
import { JwtAuthGuard } from "../auth/guards/jwt.guard";
import { RolesGuard } from "../auth/guards/roles.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { Roles } from "../auth/decorators/roles.decorator";
import { RequirePermission } from "../auth/decorators/require-permission.decorator";
import { ModuleEnabledGuard } from "../tenant/guards/module-enabled.guard";
import { RequireModule } from "../tenant/decorators/require-module.decorator";
import { QuotationsService } from "./quotations.service";
import {
  CreateQuotationDto,
  UpdateQuotationDto,
  UpdateQuotationStatusDto,
} from "./dto/quotation.dto";

type AuthReq = Request & { user: AuthUser };

@ApiTags("Quotations")
@ApiBearerAuth("jwt")
@UseGuards(JwtAuthGuard, RolesGuard, PermissionsGuard, ModuleEnabledGuard)
@RequireModule("quotation_builder")
@Roles("admin")
@Controller("admin/quotations")
export class QuotationsController {
  constructor(private readonly quotationsService: QuotationsService) {}

  @Get()
  @RequirePermission("quotations:view")
  @ApiOperation({ summary: "Listar cotizaciones del tenant" })
  async list(
    @Req() req: AuthReq,
    @Query("status") status?: string,
    @Query("dateFrom") dateFrom?: string,
    @Query("dateTo") dateTo?: string,
    @Query("page", new DefaultValuePipe(1), ParseIntPipe) page = 1,
    @Query("limit", new DefaultValuePipe(20), ParseIntPipe) limit = 20,
  ) {
    return this.quotationsService.list(this.tid(req), {
      status,
      dateFrom,
      dateTo,
      page,
      limit,
    });
  }

  @Post()
  @RequirePermission("quotations:manage")
  @ApiOperation({ summary: "Crear nueva cotización" })
  async create(@Req() req: AuthReq, @Body() dto: CreateQuotationDto) {
    return this.quotationsService.create(this.tid(req), dto, req.user.email);
  }

  @Get(":id")
  @RequirePermission("quotations:view")
  @ApiOperation({ summary: "Obtener cotización por ID" })
  async findOne(@Req() req: AuthReq, @Param("id") id: string) {
    return this.quotationsService.findOne(this.tid(req), id);
  }

  @Patch(":id")
  @RequirePermission("quotations:manage")
  @ApiOperation({ summary: "Actualizar cotización" })
  async update(
    @Req() req: AuthReq,
    @Param("id") id: string,
    @Body() dto: UpdateQuotationDto,
  ) {
    return this.quotationsService.update(this.tid(req), id, dto);
  }

  @Patch(":id/status")
  @RequirePermission("quotations:manage")
  @ApiOperation({ summary: "Cambiar estado de la cotización" })
  async updateStatus(
    @Req() req: AuthReq,
    @Param("id") id: string,
    @Body() dto: UpdateQuotationStatusDto,
  ) {
    return this.quotationsService.updateStatus(this.tid(req), id, dto.status);
  }

  @Delete(":id")
  @RequirePermission("quotations:manage")
  @ApiOperation({ summary: "Eliminar cotización" })
  async remove(@Req() req: AuthReq, @Param("id") id: string) {
    await this.quotationsService.remove(this.tid(req), id);
    return { ok: true };
  }

  private tid(req: AuthReq): string {
    const id = req.user?.tenantId;
    if (!id) throw new BadRequestException("tenantId requerido");
    return id;
  }
}
