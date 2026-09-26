import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MulterModule } from '@nestjs/platform-express';
import { CodeFile } from './code-file.entity';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { ProjectsModule } from '../projects/projects.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([CodeFile]),
    MulterModule.register({ storage: undefined }), // memory storage; buffer handled in-service
    ProjectsModule,
  ],
  providers: [FilesService],
  controllers: [FilesController],
  exports: [FilesService, TypeOrmModule],
})
export class FilesModule {}
