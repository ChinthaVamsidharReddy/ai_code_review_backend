import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { ChatSession } from './chat-session.entity';

export type ChatRole = 'user' | 'assistant';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  sessionId: string;

  @ManyToOne(() => ChatSession, (s) => s.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'sessionId' })
  session: ChatSession;

  @Column({ type: 'varchar' })
  role: ChatRole;

  @Column({ type: 'text' })
  content: string;

  /** Which file paths were used as context for this answer, so the UI can
   *  show "answered using: auth.service.ts, jwt.strategy.ts". */
  @Column({ type: 'simple-array', default: '' })
  contextFilePaths: string[];

  @CreateDateColumn()
  createdAt: Date;
}
