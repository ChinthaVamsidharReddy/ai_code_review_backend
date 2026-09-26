import 'dotenv/config';
import { DataSource } from 'typeorm';
import { User } from '../users/user.entity';
import { Project } from '../projects/project.entity';
import { CodeFile } from '../files/code-file.entity';
import { AiProviderConfig } from '../ai-providers/ai-provider-config.entity';
import { Review } from '../reviews/review.entity';
import { ReviewIssue } from '../reviews/review-issue.entity';
import { ChatSession } from '../chat/chat-session.entity';
import { ChatMessage } from '../chat/chat-message.entity';

/**
 * Standalone DataSource, used only by the TypeORM CLI for generating and
 * running migrations (`npm run migration:generate|run|revert`).
 * The running application gets its connection through TypeOrmModule in
 * app.module.ts, configured from the same environment variables.
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'ai_code_review',
  entities: [User, Project, CodeFile, AiProviderConfig, Review, ReviewIssue, ChatSession, ChatMessage],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
});
