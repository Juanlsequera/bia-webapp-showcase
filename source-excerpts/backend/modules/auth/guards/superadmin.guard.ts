import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from "@nestjs/common";
import type { AuthUser } from "@foodorder/types";

/**
 * Guard que verifica que el usuario tiene rol 'superadmin'.
 * Se aplica a endpoints que requieren acceso global a todos los tenants.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user: AuthUser }>();
    if (!user || user.role !== "superadmin") {
      throw new ForbiddenException(
        "Solo superadmin puede acceder a este endpoint",
      );
    }
    return true;
  }
}
