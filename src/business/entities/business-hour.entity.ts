import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm';
import { BusinessProfile } from './business.entity';

@Entity()
export class BusinessHour {
  @PrimaryGeneratedColumn()
  id: number;

  @Column() // '@dayColumn' nahi hota, simple '@Column()' use karein
  dayOfWeek!: string; // Isme hum "Monday", "Tuesday" store karenge

  @Column({ type: 'time' }) // Postgres mein sirf 'time' (09:00:00) store karega
  openTime!: string;

  @Column({ type: 'time' })
  closeTime!: string;

  @ManyToOne(() => BusinessProfile, (profile) => profile.hours, {
    onDelete: 'CASCADE',
  })
  business!: BusinessProfile;
}
