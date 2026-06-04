import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";

// ── Sub-schemas ────────────────────────────────────────────────────────────────
@Schema({ _id: false })
export class WeeklyHourRange {
  @Prop({ type: String, required: true })
  open: string; // HH:MM (ej: '09:00')

  @Prop({ type: String, required: true })
  close: string; // HH:MM (ej: '18:00')

  @Prop({ type: Boolean, default: true })
  enabled: boolean;
}

@Schema({ _id: false })
export class StaffScheduleDoc {
  @Prop({
    type: WeeklyHourRange,
    default: { open: "09:00", close: "18:00", enabled: true },
  })
  monday: WeeklyHourRange;

  @Prop({
    type: WeeklyHourRange,
    default: { open: "09:00", close: "18:00", enabled: true },
  })
  tuesday: WeeklyHourRange;

  @Prop({
    type: WeeklyHourRange,
    default: { open: "09:00", close: "18:00", enabled: true },
  })
  wednesday: WeeklyHourRange;

  @Prop({
    type: WeeklyHourRange,
    default: { open: "09:00", close: "18:00", enabled: true },
  })
  thursday: WeeklyHourRange;

  @Prop({
    type: WeeklyHourRange,
    default: { open: "09:00", close: "18:00", enabled: true },
  })
  friday: WeeklyHourRange;

  @Prop({
    type: WeeklyHourRange,
    default: { open: "09:00", close: "18:00", enabled: true },
  })
  saturday: WeeklyHourRange;

  @Prop({
    type: WeeklyHourRange,
    default: { open: "09:00", close: "13:00", enabled: true },
  })
  sunday: WeeklyHourRange;

  @Prop({ type: [String], default: [] })
  blockedDates: string[]; // ISO date strings YYYY-MM-DD — vacaciones, días libres
}

// ── Staff document ─────────────────────────────────────────────────────────────
@Schema({ timestamps: true, collection: "staff" })
export class Staff {
  @Prop({ type: Types.ObjectId, ref: "Tenant", required: true, index: true })
  tenantId: Types.ObjectId;

  @Prop({ required: true, trim: true, minlength: 1, maxlength: 100 })
  name: string;

  @Prop({ type: String, default: null })
  avatar_url: string | null;

  @Prop({ type: String, default: null })
  bio: string | null;

  @Prop({ type: [{ type: Types.ObjectId, ref: "Product" }], default: [] })
  serviceIds: Types.ObjectId[];

  @Prop({ type: StaffScheduleDoc, required: true })
  schedule: StaffScheduleDoc;

  @Prop({ type: Boolean, default: true, index: true })
  active: boolean;
}

export type StaffDocument = Staff & Document;
export const StaffSchema = SchemaFactory.createForClass(Staff);
StaffSchema.index({ tenantId: 1, active: 1 });
