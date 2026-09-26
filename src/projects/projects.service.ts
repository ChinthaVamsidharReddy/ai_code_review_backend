import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ILike, Repository } from 'typeorm';
import { Project } from './project.entity';
import { CreateProjectDto } from './dto/create-project.dto';
import { ListProjectsDto } from './dto/list-projects.dto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProjectsService {
  constructor(
    @InjectRepository(Project) private readonly repo: Repository<Project>,
    private readonly configService: ConfigService,
  ) {}

  async create(ownerId: string, dto: CreateProjectDto): Promise<Project> {
    const project = this.repo.create({ ...dto, ownerId });
    return this.repo.save(project);
  }

  async list(ownerId: string, query: ListProjectsDto) {
    const { page, pageSize, search } = query;
    const [items, total] = await this.repo.findAndCount({
      where: { ownerId, ...(search ? { name: ILike(`%${search}%`) } : {}) },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { items, total, page, pageSize };
  }

  /** Loads a project and asserts the caller owns it. Every project-scoped
   *  endpoint in the app (files, reviews, chat) goes through this so
   *  ownership is enforced in exactly one place. */
  async getOwnedProject(projectId: string, ownerId: string): Promise<Project> {
    const project = await this.repo.findOne({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    if (project.ownerId !== ownerId) {
      throw new ForbiddenException('You do not have access to this project');
    }
    return project;
  }

  async remove(projectId: string, ownerId: string): Promise<void> {
    const project = await this.getOwnedProject(projectId, ownerId);
    await this.repo.remove(project);
    // Best-effort cleanup of on-disk storage for this project. Failure to
    // delete files should not fail the API call — the DB rows (source of
    // truth) are already gone via cascade.
    const projectDir = path.join(this.configService.get<string>('storage.root') as string, projectId);
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
