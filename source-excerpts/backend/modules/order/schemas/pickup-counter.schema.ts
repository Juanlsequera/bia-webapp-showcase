import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type PickupCounterDocument = PickupCounter & Document;

/**
 * Un documento por tenant por día de operación.
 * Se incrementa atómicamente con $inc al crear cada pedido takeaway.
 * La `date` se deriva con la TZ del tenant (no UTC) para evitar colisiones
 * al cambiar de día en distintas zonas horarias.
 */
@Schema({ collection: "pickup_counters" })
export class PickupCounter {
  @Prop({ type: Types.ObjectId, ref: "Tenant", required: true })
  tenantId: Types.ObjectId;

  /** Fecha local del tenant en formato 'YYYY-MM-DD'. */
  @Prop({ required: true })
  date: string;

  /** Contador incremental del día. Comienza en 1 con el primer pedido. */
  @Prop({ required: true, default: 0 })
  counter: number;
}

export const PickupCounterSchema = SchemaFactory.createForClass(PickupCounter);
PickupCounterSchema.index({ tenantId: 1, date: 1 }, { unique: true });
