import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiProviderConfig } from './ai-provider-config.entity';
import { AiProvidersService } from './ai-providers.service';
import { AiProvidersController } from './ai-providers.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AiProviderConfig])],
  providers: [AiProvidersService],
  controllers: [AiProvidersController],
  exports: [AiProvidersService],
})
export class AiProvidersModule {}
