import { Injectable } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import * as webPush from "web-push";
import { AppLogger } from "../logger/logger.service";
import {
  PushSubscription,
  PushSubscriptionDocument,
} from "./schemas/push-subscription.schema";

export interface NotifyPayload {
  title: string;
  body: string;
  /** URL a abrir cuando el cliente toca la notificación */
  url?: string;
}

/**
 * PushService — Web Push W3C (sin Firebase/APNs directo).
 * Requiere VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT en .env.
 *
 * Las suscripciones se almacenan por orderId — múltiples devices por orden.
 * Una sub con statusCode 410 (Gone) se elimina automáticamente.
 */
@Injectable()
export class PushService {
  private readonly configured: boolean;

  constructor(
    @InjectModel(PushSubscription.name)
    private readonly subModel: Model<PushSubscriptionDocument>,
    private readonly logger: AppLogger,
  ) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const subj = process.env.VAPID_SUBJECT;

    this.configured = !!(pub && priv && subj);

    if (this.configured) {
      webPush.setVapidDetails(subj!, pub!, priv!);
      this.logger.log("PushService configurado con VAPID", "PushService");
    } else {
      this.logger.warn(
        "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT no configurados — " +
          "Web Push deshabilitado. Generar con: node -e \"console.log(require('web-push').generateVAPIDKeys())\"",
        "PushService",
      );
    }
  }

  /**
   * Registra o actualiza una suscripción de push para una orden específica.
   * Upsert por endpoint — idempotente, seguro llamar múltiples veces.
   */
  async subscribe(input: {
    orderId: string;
    tenantId: string;
    endpoint: string;
    p256dh: string;
    auth: string;
    traceId?: string;
  }): Promise<void> {
    await this.subModel
      .updateOne(
        { endpoint: input.endpoint },
        {
          $set: {
            orderId: new Types.ObjectId(input.orderId),
            tenantId: new Types.ObjectId(input.tenantId),
            p256dh: input.p256dh,
            auth: input.auth,
            traceId: input.traceId ?? null,
          },
        },
        { upsert: true },
      )
      .exec();
  }

  /**
   * Envía notificación a TODOS los devices suscritos a una orden.
   * Falla silenciosamente si Push no está configurado (no rompe el flow).
   * Subs con statusCode 410 (expiradas) se borran automáticamente.
   */
  async notifyOrder(orderId: string, payload: NotifyPayload): Promise<void> {
    if (!this.configured) return;

    const subs = await this.subModel
      .find({
        orderId: new Types.ObjectId(orderId),
      })
      .lean()
      .exec();

    if (subs.length === 0) return;

    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webPush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh, auth: sub.auth },
            },
            JSON.stringify(payload),
          );
        } catch (err: unknown) {
          const statusCode = (err as { statusCode?: number }).statusCode;
          if (statusCode === 410) {
            // Suscripción expirada — limpiar para no acumular basura
            await this.subModel.deleteOne({ _id: sub._id }).exec();
            this.logger.log(
              `Push sub expirada eliminada: ${sub.endpoint.slice(-20)}`,
              "PushService",
            );
          } else {
            this.logger.logError(err, "PushService.notifyOrder", { orderId });
          }
        }
      }),
    );
  }
}
