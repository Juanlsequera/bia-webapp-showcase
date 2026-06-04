import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { JwtPayload, AuthUser } from "@foodorder/types";
import { User, UserDocument } from "./schemas/user.schema";
import { RefreshTokenService } from "./refresh-token.service";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly refreshTokenService: RefreshTokenService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_SECRET!,
      algorithms: ["HS256"], // previene algorithm-confusion attacks
    });
  }

  async validate(payload: JwtPayload): Promise<AuthUser> {
    // Revocación: si el access fue blacklisteado (logout o rotación de refresh),
    // rechazamos aunque la firma esté OK y no haya expirado.
    if (
      payload.jti &&
      (await this.refreshTokenService.isAccessBlacklisted(payload.jti))
    ) {
      throw new UnauthorizedException("Sesión revocada");
    }

    const user = await this.userModel
      .findOne({ _id: payload.sub, active: true })
      .lean()
      .exec();
    if (!user)
      throw new UnauthorizedException("Usuario no encontrado o inactivo");
    return {
      _id: String(user._id),
      email: user.email,
      role: user.role,
      tenantId: user.tenantId ? String(user.tenantId) : undefined,
    };
  }
}
