import { Module } from '@nestjs/common';
import { ArchitectureAnalysisService } from './architecture-analysis.service';
import { ArchitectureAnalysisController } from './architecture-analysis.controller';
import { FilesModule } from '../files/files.module';
import { AiProvidersModule } from '../ai-providers/ai-providers.module';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [FilesModule, AiProvidersModule, ProjectsModule],
  providers: [ArchitectureAnalysisService],
  controllers: [ArchitectureAnalysisController],
})
export class ArchitectureAnalysisModule {}
