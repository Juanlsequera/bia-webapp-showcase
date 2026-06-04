import { Injectable, UnauthorizedException } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";

@Injectable()
export class JwtAuthGuard extends AuthGuard("jwt") {
  handleRequest<T>(err: Error | null, user: T | false): T {
    if (err || !user)
      throw new UnauthorizedException("Token invalido o expirado");
    return user;
  }
}
