import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { FilesService } from './files.service';

@UseGuards(JwtAuthGuard)
@Controller('projects/:projectId/files')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly projectsService: ProjectsService,
  ) {}

  @Post('upload/zip')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB archive ceiling
      // Defense in depth alongside the filename check below: reject at the
      // multer layer before the buffer is even fully accepted, by both
      // extension and declared MIME type. Neither check alone is
      // trustworthy (both are client-supplied and can be spoofed), which
      // is exactly why FilesService.ingestZip() also validates the actual
      // bytes via AdmZip — this just avoids doing that work for an obviously
      // wrong upload.
      fileFilter: (_req, file, callback) => {
        const validExtension = file.originalname.toLowerCase().endsWith('.zip');
        const validMimeType = ['application/zip', 'application/x-zip-compressed', 'application/octet-stream'].includes(
          file.mimetype,
        );
        if (!validExtension || !validMimeType) {
          return callback(new BadRequestException('Only .zip archives are accepted'), false);
        }
        callback(null, true);
      },
    }),
  )
  async uploadZip(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    await this.projectsService.getOwnedProject(projectId, user.userId); // ownership + existence check
    if (!file) throw new BadRequestException('No file uploaded (expected form field "file")');
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      throw new BadRequestException('Only .zip archives are accepted');
    }
    const files = await this.filesService.ingestZip(projectId, file.buffer);
    return { fileCount: files.length };
  }

  @Get('tree')
  async tree(@CurrentUser() user: AuthenticatedUser, @Param('projectId', ParseUUIDPipe) projectId: string) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.filesService.buildTree(projectId);
  }

  @Get(':fileId/content')
  async content(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('fileId', ParseUUIDPipe) fileId: string,
  ) {
    await this.projectsService.getOwnedProject(projectId, user.userId);
    return this.filesService.getFileContent(projectId, fileId);
  }
}
