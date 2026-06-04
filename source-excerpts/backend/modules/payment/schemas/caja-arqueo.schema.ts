import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type CajaArqueoDocument = CajaArqueo & Document;

@Schema({ timestamps: true, collection: "caja_arqueos" })
export class CajaArqueo {
  @Prop({ type: Types.ObjectId, ref: "Tenant", required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ type: String, required: true })
  date: string;

  @Prop({ type: Number, default: null })
  efectivo_fisico: number | null;

  @Prop({ type: Number, default: null })
  debito_fisico: number | null;

  @Prop({ type: String, default: null })
  debito_receipt_url: string | null;

  @Prop({ type: String, default: null })
  debito_receipt_public_id: string | null;

  @Prop({ type: String, default: null })
  notas: string | null;

  @Prop({ type: String, required: true })
  cerrado_por: string;

  /** true cuando el admin ejecutó "Cerrar caja del día" formalmente. */
  @Prop({ type: Boolean, default: false })
  is_closed: boolean;

  /** Timestamp del cierre formal. null si aún no se cerró. */
  @Prop({ type: Date, default: null })
  closed_at: Date | null;
}

export const CajaArqueoSchema = SchemaFactory.createForClass(CajaArqueo);
CajaArqueoSchema.index({ tenantId: 1, date: 1 }, { unique: true });
