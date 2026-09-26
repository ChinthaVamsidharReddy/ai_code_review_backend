import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AiProviderConfig } from './ai-provider-config.entity';
import { UpsertProviderDto } from './dto/upsert-provider.dto';
import { decryptSecret, encryptSecret } from '../common/crypto.util';
import { AiClient } from './ai-client.interface';
import { OpenAiCompatibleClient } from './openai-compatible.client';

export type SafeProviderDto = Omit<AiProviderConfig, 'apiKeyEncrypted'> & { hasApiKey: boolean };

@Injectable()
export class AiProvidersService {
  constructor(
    @InjectRepository(AiProviderConfig) private readonly repo: Repository<AiProviderConfig>,
    private readonly configService: ConfigService,
  ) {}

  private encryptionSecret(): string {
    return this.configService.get<string>('jwt.secret') as string;
  }

  /** Strips the encrypted key out of anything sent to the client. The
   *  frontend only ever learns *whether* a key is set, never its value. */
  private toSafeDto(config: AiProviderConfig): SafeProviderDto {
    const { apiKeyEncrypted, ...rest } = config;
    return { ...rest, hasApiKey: !!apiKeyEncrypted } as SafeProviderDto;
  }

  async list(userId: string): Promise<SafeProviderDto[]> {
    const configs = await this.repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    return configs.map((c) => this.toSafeDto(c));
  }

  async create(userId: string, dto: UpsertProviderDto): Promise<SafeProviderDto> {
    if (dto.isDefault) {
      await this.repo.update({ userId }, { isDefault: false });
    }
    const config = this.repo.create({
      userId,
      name: dto.name,
      providerType: dto.providerType as AiProviderConfig['providerType'],
      baseUrl: dto.baseUrl,
      model: dto.model,
      enabled: dto.enabled ?? true,
      isDefault: dto.isDefault ?? false,
      apiKeyEncrypted: dto.apiKey ? encryptSecret(dto.apiKey, this.encryptionSecret()) : undefined,
    });
    const saved = await this.repo.save(config);
    return this.toSafeDto(saved);
  }

  async remove(userId: string, id: string): Promise<void> {
    const config = await this.repo.findOne({ where: { id, userId } });
    if (!config) throw new NotFoundException('AI provider not found');
    await this.repo.remove(config);
  }

  /** Resolves which provider config a request should use: an explicit
   *  providerId if given, otherwise the user's default, otherwise their
   *  most recently created enabled config. */
  async resolveClient(userId: string, providerId?: string): Promise<{ client: AiClient; config: AiProviderConfig }> {
    let config: AiProviderConfig | null = null;

    if (providerId) {
      config = await this.repo.findOne({ where: { id: providerId, userId } });
    } else {
      config = await this.repo.findOne({ where: { userId, isDefault: true, enabled: true } });
      if (!config) {
        config = await this.repo.findOne({ where: { userId, enabled: true }, order: { createdAt: 'DESC' } });
      }
    }

    if (!config) {
      throw new BadRequestException(
        'No AI provider is configured. Add one under Settings → AI Providers (base URL, model, and optionally an API key).',
      );
    }
    if (!config.enabled) {
      throw new BadRequestException(`AI provider "${config.name}" is disabled`);
    }

    const apiKey = config.apiKeyEncrypted ? decryptSecret(config.apiKeyEncrypted, this.encryptionSecret()) : undefined;
    const client = new OpenAiCompatibleClient(config.baseUrl, apiKey, config.model);
    return { client, config };
  }
}
