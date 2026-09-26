import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Project } from '../projects/project.entity';
import { ReviewIssue } from './review-issue.entity';

export type ReviewMode = 'security' | 'performance' | 'quality';
export type ReviewScope = 'single_file' | 'multi_file' | 'project';
export type ReviewStatus = 'completed' | 'failed';

@Entity('reviews')
@Index(['projectId', 'createdAt'])
export class Review {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  @ManyToOne(() => Project, (project) => project.reviews, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  @Column()
  requestedByUserId: string;

  @Column({ type: 'varchar' })
  mode: ReviewMode;

  @Column({ type: 'varchar' })
  scope: ReviewScope;

  /** File paths this review covered (1 for single_file, N for multi_file,
   *  all project text files for project scope). Kept for review-history
   *  display and re-runs. */
  @Column({ type: 'simple-array', default: '' })
  filePaths: string[];

  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'simple-array', default: '' })
  generalRecommendations: string[];

  @Column({ type: 'varchar' })
  status: ReviewStatus;

  @Column({ type: 'text', nullable: true })
  errorMessage?: string;

  @Column({ nullable: true })
  aiModel?: string;

  @OneToMany(() => ReviewIssue, (issue) => issue.review, { cascade: true })
  issues: ReviewIssue[];

  @CreateDateColumn()
  createdAt: Date;
}
