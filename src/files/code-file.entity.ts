import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Project } from '../projects/project.entity';

@Entity('code_files')
@Index(['projectId', 'relativePath'], { unique: true })
export class CodeFile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  projectId: string;

  @ManyToOne(() => Project, (project) => project.files, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'projectId' })
  project: Project;

  /** Path relative to the project's storage root, e.g. "src/index.ts". Always
   *  forward-slash, always validated to stay inside the project directory. */
  @Column()
  relativePath: string;

  @Column()
  fileName: string;

  @Column({ nullable: true })
  extension?: string;

  @Column({ type: 'bigint' })
  sizeBytes: number;

  @Column({ default: false })
  isBinary: boolean;

  @CreateDateColumn()
  createdAt: Date;
}
