import { Module } from "@nestjs/common";
import { CartController } from "./cart.controller";
import { CartService } from "./cart.service";
import { CartRedisProvider } from "./redis.provider";

@Module({
  controllers: [CartController],
  providers: [CartRedisProvider, CartService],
  exports: [CartService],
})
export class CartModule {}
