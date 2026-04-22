import {
  Column,
  CreateDateColumn,
  Entity,
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

  @Column({ type: 'varchar', unique: true })
  locationLink: string;

  @CreateDateColumn()
  createdAt: Date;

  @CreateDateColumn()
  foundAt: Date;
}
