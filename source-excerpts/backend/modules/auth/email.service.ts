import { Injectable, OnModuleInit } from "@nestjs/common";
import { AppLogger } from "../logger/logger.service";

/**
 * EmailService — abstracción mínima sobre el provider de email.
 *
 * Estrategia (decidida en docs/07-backlog-priorizado.md P1.5):
 *  - **Producción**: si `RESEND_API_KEY` está definida, usa la API REST de
 *    Resend (https://resend.com — free tier 3000 emails/mes). Sin SDK extra
 *    porque Resend tiene una API HTTP simple y queremos minimizar deps.
 *  - **Desarrollo**: si no hay `RESEND_API_KEY`, NO falla — loguea el cuerpo
 *    del email a la consola del backend con un banner DEV MODE. El
 *    desarrollador puede leer el código directamente del log para probar
 *    localmente. **El código nunca se devuelve por la API**: el único
 *    canal válido para el cliente es su email registrado.
 *
 * Razón de no instalar el paquete `resend`: agregamos una dep sólo cuando
 * tengamos cuenta + API key real. Mientras tanto Resend HTTP API alcanza.
 */
@Injectable()
export class EmailService implements OnModuleInit {
  constructor(private readonly logger: AppLogger) {}

  /**
   * Alerta única al arrancar si estamos en producción sin provider de email.
   * Se emite con severity `error` para disparar alerta en BetterStack/Logtail
   * (versus el warn por cada email que es ruido). Útil para detectar el caso
   * en que un deploy va a prod sin `RESEND_API_KEY` y el forgot-password
   * queda silenciosamente roto.
   */
  onModuleInit(): void {
    const isProd = process.env.NODE_ENV === "production";
    const hasResend = !!process.env.RESEND_API_KEY;
    if (isProd && !hasResend) {
      this.logger.logError(
        new Error(
          "[CONFIG-ERROR] EMAIL_PROVIDER_MISSING — RESEND_API_KEY no configurada en producción. " +
            "Los flujos forgot-password y welcome emails NO funcionarán. " +
            "Crear cuenta en https://resend.com y setear RESEND_API_KEY + EMAIL_FROM_ADDRESS.",
        ),
        "EmailService.onModuleInit",
        { env: process.env.NODE_ENV },
      );
    }
  }

  /**
   * Envía un email simple (texto plano + HTML). Devuelve `true` si el
   * provider real lo aceptó (o si estamos en dev mode y se logueó).
   * Nunca tira: si el provider falla, loguea y devuelve `false` para que
   * el caller decida.
   */
  async send(opts: {
    to: string;
    subject: string;
    text: string;
    html?: string;
  }): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY;
    const from =
      process.env.EMAIL_FROM_ADDRESS ?? "FoodOrder <onboarding@resend.dev>";

    if (!apiKey) {
      // Dev mode — sin provider configurado. Logueamos el cuerpo del email
      // a la consola del backend para que el desarrollador pueda leer el
      // código durante pruebas locales. **En producción esto NO es válido**:
      // sin `RESEND_API_KEY` ningún usuario real recibe el email y el flow
      // de reset queda silenciosamente roto. Dejamos un banner llamativo
      // para que sea imposible no notarlo en logs.
      //
      // En producción redactamos cuerpo y subject por si los logs van a un
      // sink externo (BetterStack) — los reset codes nunca deben quedar
      // expuestos en sistemas de terceros, aunque la app esté mal configurada.
      const isProd = process.env.NODE_ENV === "production";
      const safeSubject = isProd ? "[REDACTED]" : opts.subject;
      const safeBody = isProd
        ? "[REDACTED — código de reset no se loguea en prod]"
        : opts.text;

      const banner =
        "\n" +
        "╔══════════════════════════════════════════════════════════════╗\n" +
        "║  EmailService DEV MODE — RESEND_API_KEY no configurado.      ║\n" +
        "║  El email NO se envió. Configurar provider antes de prod.    ║\n" +
        "╚══════════════════════════════════════════════════════════════╝";
      this.logger.warn(
        `${banner}\n` +
          `  to:      ${opts.to}\n` +
          `  subject: ${safeSubject}\n` +
          `  body:    ${safeBody}\n`,
        "EmailService",
      );
      return false;
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from,
          to: [opts.to],
          subject: opts.subject,
          text: opts.text,
          ...(opts.html && { html: opts.html }),
        }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        this.logger.logError(
          new Error(`Resend HTTP ${res.status}: ${body}`),
          "EmailService.send",
          { to: opts.to, subject: opts.subject },
        );
        return false;
      }
      this.logger.log(
        `Email enviado a ${opts.to}: "${opts.subject}"`,
        "EmailService",
      );
      return true;
    } catch (err) {
      this.logger.logError(err, "EmailService.send", {
        to: opts.to,
        subject: opts.subject,
      });
      return false;
    }
  }
}
