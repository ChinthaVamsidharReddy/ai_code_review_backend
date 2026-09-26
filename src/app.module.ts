import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import configuration from './config/configuration';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

import { UsersModule } from './users/users.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { FilesModule } from './files/files.module';
import { AiProvidersModule } from './ai-providers/ai-providers.module';
import { ReviewsModule } from './reviews/reviews.module';
import { ChatModule } from './chat/chat.module';
import { DocsGeneratorModule } from './docs-generator/docs-generator.module';
import { ArchitectureAnalysisModule } from './architecture-analysis/architecture-analysis.module';

import { User } from './users/user.entity';
import { Project } from './projects/project.entity';
import { CodeFile } from './files/code-file.entity';
import { AiProviderConfig } from './ai-providers/ai-provider-config.entity';
import { Review } from './reviews/review.entity';
import { ReviewIssue } from './reviews/review-issue.entity';
import { ChatSession } from './chat/chat-session.entity';
import { ChatMessage } from './chat/chat-message.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get('db.host'),
        port: config.get('db.port'),
        username: config.get('db.username'),
        password: config.get('db.password'),
        database: config.get('db.name'),
        entities: [User, Project, CodeFile, AiProviderConfig, Review, ReviewIssue, ChatSession, ChatMessage],
        // synchronize is fine for this assessment/demo environment; a real
        // deployment would rely solely on the generated migrations instead
        // (see backend/README section on migrations).
        synchronize: config.get('nodeEnv') !== 'production',
      }),
    }),
    // Global rate limiting: protects the API (and, transitively, AI-provider
    // spend) from being hammered. Individual AI-calling endpoints could get
    // tighter, dedicated limits later without changing this setup.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    UsersModule,
    AuthModule,
    ProjectsModule,
    FilesModule,
    AiProvidersModule,
    ReviewsModule,
    ChatModule,
    DocsGeneratorModule,
    ArchitectureAnalysisModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
