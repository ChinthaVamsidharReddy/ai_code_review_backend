import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { AiProviderConfig } from './ai-provider-config.entity';
import { UpsertProviderDto } from './dto/upsert-provider.dto';
import { UpdateProviderDto } from './dto/update-provider.dto';
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

  /** Partial update — this is what lets a provider be enabled/disabled or
   *  set as default without deleting and re-adding it (re-adding would
   *  also mean re-typing the API key every time, which is exactly what
   *  encrypting it at rest was supposed to avoid). Only re-encrypts the
   *  API key if a new one was actually sent. */
  async update(userId: string, id: string, dto: UpdateProviderDto): Promise<SafeProviderDto> {
    const config = await this.repo.findOne({ where: { id, userId } });
    if (!config) throw new NotFoundException('AI provider not found');

    if (dto.isDefault) {
      await this.repo.update({ userId }, { isDefault: false });
    }

    if (dto.name !== undefined) config.name = dto.name;
    if (dto.providerType !== undefined) config.providerType = dto.providerType as AiProviderConfig['providerType'];
    if (dto.baseUrl !== undefined) config.baseUrl = dto.baseUrl;
    if (dto.model !== undefined) config.model = dto.model;
    if (dto.enabled !== undefined) config.enabled = dto.enabled;
    if (dto.isDefault !== undefined) config.isDefault = dto.isDefault;
    if (dto.apiKey) config.apiKeyEncrypted = encryptSecret(dto.apiKey, this.encryptionSecret());

    const saved = await this.repo.save(config);
    return this.toSafeDto(saved);
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

    const apiKey = this.safeDecryptApiKey(config);
    const client = new OpenAiCompatibleClient(config.baseUrl, apiKey, config.model);
    return { client, config };
  }

  /**
   * Provider API keys are encrypted with a key derived from JWT_SECRET
   * (see common/crypto.util.ts). If JWT_SECRET changes after a key was
   * saved — a regenerated .env, a fresh secret, deploying to a new
   * environment — AES-GCM correctly refuses to decrypt (this is the
   * authentication tag doing its job, not corruption). Previously this
   * threw an unhandled crypto error from inside resolveClient, which every
   * caller (reviews/chat/docs/architecture) invokes *before* their own
   * try/catch block — so it surfaced as an opaque 500 instead of a message
   * telling the user what to actually do about it. Catching it here, at
   * the source, fixes that for every caller at once.
   */
  private safeDecryptApiKey(config: AiProviderConfig): string | undefined {
    if (!config.apiKeyEncrypted) return undefined;
    try {
      return decryptSecret(config.apiKeyEncrypted, this.encryptionSecret());
    } catch {
      throw new BadRequestException(
        `The saved API key for AI provider "${config.name}" could not be decrypted — this happens when the server's JWT_SECRET has changed since the key was saved (JWT_SECRET is also used to encrypt provider keys at rest). Fix: remove this provider under AI Providers settings and re-add it with the same API key so it's re-encrypted with the current secret.`,
      );
    }
  }
}
