import { createParamDecorator, ExecutionContext } from "@nestjs/common";
import { AuthUser } from "@foodorder/types";
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): AuthUser =>
    ctx.switchToHttp().getRequest<{ user: AuthUser }>().user,
);
