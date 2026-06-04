import { Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import { MongooseModule } from "@nestjs/mongoose";
import { AuthController } from "./auth.controller";
import { AuthService } from "./auth.service";
import { JwtStrategy } from "./jwt.strategy";
import { User, UserSchema } from "./schemas/user.schema";
import { Tenant, TenantSchema } from "../tenant/schemas/tenant.schema";
import { EmailService } from "./email.service";
import { AuthRedisProvider } from "./redis.provider";
import { RefreshTokenService } from "./refresh-token.service";

@Module({
  imports: [
    PassportModule,
    // registerAsync + useFactory → las env vars se leen en runtime, después
    // de que ConfigModule.forRoot() cargó el .env. Si usamos register() simple,
    // process.env.JWT_SECRET se evalúa al importar el archivo y queda undefined.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: process.env.JWT_EXPIRES_IN ?? "10h" },
      }),
    }),
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Tenant.name, schema: TenantSchema },
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    EmailService,
    AuthRedisProvider,
    RefreshTokenService,
  ],
  exports: [AuthService, EmailService, JwtModule, RefreshTokenService],
})
export class AuthModule {}
