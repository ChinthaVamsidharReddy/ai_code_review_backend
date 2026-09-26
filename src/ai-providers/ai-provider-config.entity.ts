import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type ProviderType = 'openai' | 'lm-studio' | 'ollama' | 'openrouter' | 'custom';

@Entity('ai_provider_configs')
@Index(['userId'])
export class AiProviderConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  userId: string;

  @Column()
  name: string; // user-facing label, e.g. "OpenRouter - Llama 3.1"

  @Column({ type: 'varchar' })
  providerType: ProviderType;

  @Column()
  baseUrl: string; // e.g. https://openrouter.ai/api/v1

  /** AES-256-GCM encrypted at rest. Never returned to the client in
   *  plaintext — see AiProvidersService.toSafeDto(). */
  @Column({ type: 'text', nullable: true })
  apiKeyEncrypted?: string;

  @Column()
  model: string;

  @Column({ default: true })
  enabled: boolean;

  @Column({ default: false })
  isDefault: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
