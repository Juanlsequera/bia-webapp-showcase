import { Injectable } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

/**
 * Identical to JwtAuthGuard but never throws — if no token or invalid token,
 * req.user stays undefined and the request continues normally.
 * Use on endpoints that are public by default but need to identify the caller
 * when a JWT happens to be present (e.g., extractors with requiresAuth=true).
 */
@Injectable()
export class OptionalJwtGuard extends AuthGuard("jwt") {
  handleRequest<T>(_err: Error | null, user: T | false): T | undefined {
    return user || undefined;
  }
}
