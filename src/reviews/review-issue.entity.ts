import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Review } from './review.entity';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

@Entity('review_issues')
export class ReviewIssue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  reviewId: string;

  @ManyToOne(() => Review, (review) => review.issues, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'reviewId' })
  review: Review;

  @Column()
  title: string;

  @Column({ type: 'text' })
  description: string;

  @Column({ type: 'varchar' })
  severity: Severity;

  @Column({ nullable: true })
  filePath?: string;

  @Column({ nullable: true })
  lineHint?: string;

  @Column({ type: 'text', nullable: true })
  recommendation?: string;
}
