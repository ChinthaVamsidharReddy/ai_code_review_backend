import { Module } from '@nestjs/common';
import { DocsGeneratorService } from './docs-generator.service';
import { DocsGeneratorController } from './docs-generator.controller';
import { FilesModule } from '../files/files.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [FilesModule, AiProvidersModule, ProjectsModule],
  providers: [DocsGeneratorService],
  controllers: [DocsGeneratorController],
})
export class DocsGeneratorModule {}
