import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('locations')
export class Location {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  address: string;

  @Column({ nullable: true })
  phone: string;

  @Column({ default: 'Google Maps' })
  source: string;

  @Index()
  @Column({ type: 'varchar', unique: true })
  locationLink: string;

  @CreateDateColumn()
  createdAt: Date;

  @CreateDateColumn()
  foundAt: Date;

  @Column({ default: 'Pending' })
  status: string; // 'Verified' or 'Mismatch' store
}
