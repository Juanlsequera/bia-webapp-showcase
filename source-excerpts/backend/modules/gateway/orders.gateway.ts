import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from "@nestjs/websockets";
import { Logger } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { Server, Socket } from "socket.io";
import {
  JoinRoomPayload,
  JoinRoomAck,
  JwtPayload,
  roomName,
} from "@foodorder/types";
import { Types } from "mongoose";

// ── Auth context que guardamos en cada socket ────────────────────────────
interface SocketAuth {
  userId?: string;
  email?: string;
  role?: "superadmin" | "admin" | "kitchen";
  tenantId?: string;
  isPublic: boolean; // true = cliente final sin JWT (solo rooms de mesa)
}

@WebSocketGateway({
  cors: {
    // En dev aceptamos cualquier origen (.env ALLOWED_ORIGINS se parsea en main.ts
    // para HTTP, pero para WS lo dejamos abierto en dev — Socket.IO lee su propio
    // cors). En prod, OrdersGateway lee ALLOWED_ORIGINS en runtime.
    origin: (origin, cb) => {
      const allowed = (process.env.ALLOWED_ORIGINS ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // Si no hay origins configurados, permitimos todo (dev local con curl/postman)
      if (allowed.length === 0) return cb(null, true);
      if (!origin || allowed.includes(origin)) return cb(null, true);
      return cb(new Error(`Origin ${origin} no permitido`), false);
    },
    credentials: true,
  },
})
export class OrdersGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(OrdersGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwtService: JwtService) {}

  // ── Conexión: parseamos JWT si vino; si no, marcamos como público ─────
  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);

    if (!token) {
      // Sin token → cliente final (solo podrá unirse a rooms de mesa)
      (client.data as SocketAuth) = { isPublic: true };
      this.logger.log(`WS conectado (público) sid=${client.id}`);
      return;
    }

    try {
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: process.env.JWT_SECRET,
      });
      (client.data as SocketAuth) = {
        userId: payload.sub,
        email: payload.email,
        role: payload.role,
        tenantId: payload.tenantId,
        isPublic: false,
      };
      this.logger.log(
        `WS conectado ${payload.email} [${payload.role}]${
          payload.tenantId ? ` @ ${payload.tenantId}` : ""
        } sid=${client.id}`,
      );
    } catch (err) {
      // Token presente pero inválido → rechazar
      this.logger.warn(
        `WS rechazado por JWT inválido sid=${client.id}: ${(err as Error).message}`,
      );
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    const auth = client.data as SocketAuth | undefined;
    this.logger.log(
      `WS desconectado sid=${client.id}${auth?.email ? ` (${auth.email})` : ""}`,
    );
  }

  // ── Cliente pide unirse a un room — validamos permisos ────────────────
  @SubscribeMessage("join")
  handleJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: JoinRoomPayload,
  ): JoinRoomAck {
    const room = body?.room?.trim();
    if (!room) return { ok: false, room: "", error: "room requerido" };

    const auth = client.data as SocketAuth;
    const parts = room.split(":");
    if (parts.length < 2) {
      return { ok: false, room, error: "formato de room inválido" };
    }

    const [tenantId, type, tableStr] = parts;

    // superadmin pasa siempre (no tiene tenantId en JWT, puede espiar todo)
    const isSuperadmin = auth.role === "superadmin";

    if (type === "table") {
      // Rooms de mesa son públicos — cualquiera puede unirse
      if (!tableStr) {
        return { ok: false, room, error: "table requiere número" };
      }
      client.join(room);
      return { ok: true, room };
    }

    if (type === "order") {
      // Room por orderId — público (el cliente sin JWT puede escuchar su comanda).
      // El orderId es un ObjectId opaco; solo quien recibió el POST /orders lo conoce.
      const orderId = tableStr;
      if (!orderId || !Types.ObjectId.isValid(orderId)) {
        return { ok: false, room, error: "order requiere un orderId válido" };
      }
      client.join(room);
      return { ok: true, room };
    }

    if (type === "kitchen") {
      if (auth.isPublic) return { ok: false, room, error: "requiere JWT" };
      if (!isSuperadmin && !["kitchen", "admin"].includes(auth.role ?? "")) {
        return { ok: false, room, error: "rol no autorizado" };
      }
      if (!isSuperadmin && auth.tenantId !== tenantId) {
        return { ok: false, room, error: "tenant mismatch" };
      }
      client.join(room);
      return { ok: true, room };
    }

    if (type === "admin") {
      if (auth.isPublic) return { ok: false, room, error: "requiere JWT" };
      if (!isSuperadmin && auth.role !== "admin") {
        return { ok: false, room, error: "rol no autorizado" };
      }
      if (!isSuperadmin && auth.tenantId !== tenantId) {
        return { ok: false, room, error: "tenant mismatch" };
      }
      client.join(room);
      return { ok: true, room };
    }

    return { ok: false, room, error: `tipo de room desconocido: ${type}` };
  }

  // ── Helpers públicos para que OrderService (u otros) emitan eventos ──
  emitToKitchen(tenantId: string, event: string, data: unknown): void {
    this.server.to(roomName.kitchen(tenantId)).emit(event, data);
  }

  emitToAdmin(tenantId: string, event: string, data: unknown): void {
    this.server.to(roomName.admin(tenantId)).emit(event, data);
  }

  emitToTable(
    tenantId: string,
    tableNumber: number,
    event: string,
    data: unknown,
  ): void {
    this.server.to(roomName.table(tenantId, tableNumber)).emit(event, data);
  }

  emitToOrder(
    tenantId: string,
    orderId: string,
    event: string,
    data: unknown,
  ): void {
    this.server.to(roomName.order(tenantId, orderId)).emit(event, data);
  }

  // ── Extrae el JWT del handshake ───────────────────────────────────────
  // Orden: auth.token (preferido, socket.io v4), luego header Authorization,
  // luego query ?token=... (útil para debugging pero desaconsejado en prod).
  private extractToken(client: Socket): string | null {
    const auth = client.handshake.auth as { token?: string } | undefined;
    if (auth?.token) return auth.token.replace(/^Bearer\s+/i, "");

    const header = client.handshake.headers?.authorization;
    if (header) return header.replace(/^Bearer\s+/i, "");

    const query = client.handshake.query?.token;
    if (typeof query === "string" && query) return query;

    return null;
  }
}
