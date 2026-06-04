import { Prop, Schema, SchemaFactory } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { UserRole } from "@foodorder/types";

export type UserDocument = User & Document;

@Schema({ timestamps: true, collection: "users" })
export class User {
  @Prop({ type: Types.ObjectId, ref: "Tenant", required: false })
  tenantId?: Types.ObjectId; // ausente en superadmin

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ required: true, select: false }) // select:false = nunca viene en queries normales
  password: string;

  @Prop({ required: true, enum: ["superadmin", "admin", "kitchen"] })
  role: UserRole;

  @Prop({ default: true })
  active: boolean;

  /**
   * Email del usuario que creó esta cuenta.
   * null en el superadmin inicial (bootstrap) y cuentas legacy.
   * Presente en todos los creados vía POST /auth/users.
   */
  @Prop({ type: String, default: null })
  createdBy: string | null;
}

export const UserSchema = SchemaFactory.createForClass(User);
// Nota: el índice único de `email` ya lo declara el @Prop({ unique: true }) arriba.
UserSchema.index({ tenantId: 1, role: 1 });
