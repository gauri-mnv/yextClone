import { Entity, PrimaryGeneratedColumn, Column, OneToMany } from 'typeorm';
import { BusinessHour } from './business-hour.entity';

@Entity()
export class BusinessProfile {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  businessName!: string;

  @Column()
  address!: string;

  @Column()
  city!: string;

  @Column()
  phone: string;

  @Column({ default: 'Local Business' })
  category!: string;

  @Column({ type: 'jsonb', nullable: true })
  additionalAttributes: any;

  @Column({ type: 'float', nullable: true })
  lat: number;

  @Column({ type: 'float', nullable: true })
  lng: number;

  @OneToMany(() => BusinessHour, (hour) => hour.business, { cascade: true })
  hours!: BusinessHour[];
}
