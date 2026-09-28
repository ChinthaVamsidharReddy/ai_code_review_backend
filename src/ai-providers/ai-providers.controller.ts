import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AiProvidersService } from './ai-providers.service';
import { UpsertProviderDto } from './dto/upsert-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';

@UseGuards(JwtAuthGuard)
@Controller('ai-providers')
export class AiProvidersController {
  constructor(private readonly service: AiProvidersService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user.userId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertProviderDto) {
    return this.service.create(user.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProviderDto) {
    return this.service.update(user.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.service.remove(user.userId, id);
  }
}
