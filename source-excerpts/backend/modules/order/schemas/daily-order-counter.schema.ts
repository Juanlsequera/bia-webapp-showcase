import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

export type DailyOrderCounterDocument = DailyOrderCounter & Document;

/**
 * Contador atómico de órdenes por tenant por día de negocio.
 *
 * Un documento por (tenantId, date). Se incrementa con $inc al crear cada
 * orden, independientemente del orderType o archetype.
 *
 * La `date` es la "fecha de negocio" (YYYY-MM-DD) calculada con
 * `getBusinessDate()`, que respeta el `day_cutoff_hour` del tenant para
 * negocios que operan más allá de medianoche.
 */
@Schema({ collection: "daily_order_counters" })
export class DailyOrderCounter {
  @Prop({ type: Types.ObjectId, ref: "Tenant", required: true })
  tenantId: Types.ObjectId;

  /** Fecha de negocio del tenant en formato 'YYYY-MM-DD'. */
  @Prop({ required: true })
  date: string;

  /** Contador incremental del día. El primer pedido del día recibe el valor 1. */
  @Prop({ required: true, default: 0 })
  counter: number;
}

export const DailyOrderCounterSchema =
  SchemaFactory.createForClass(DailyOrderCounter);

// Un único contador por tenant por día de negocio
DailyOrderCounterSchema.index({ tenantId: 1, date: 1 }, { unique: true });
