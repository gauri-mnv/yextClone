import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BusinessService } from './business.service';
import { BusinessController } from './business.controller';
import { BusinessProfile } from './entities/business.entity';
import { BusinessHour } from './entities/business-hour.entity';
import { Location } from 'src/scraper/location.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([BusinessProfile, BusinessHour, Location]),
  ],
  controllers: [BusinessController],
  providers: [BusinessService],
  exports: [BusinessService],
})
export class BusinessModule {}
