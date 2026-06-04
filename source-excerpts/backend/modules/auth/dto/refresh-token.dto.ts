import { IsString, MinLength } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";

export class RefreshTokenDto {
  @ApiProperty({
    description: "Refresh token recibido al hacer login.",
    example: "YmFzZTY0dXJsZW5jb2RlZHJlZnJlc2h0b2tlbg",
  })
  @IsString()
  @MinLength(16, { message: "refresh_token inválido" })
  refresh_token: string;
}
