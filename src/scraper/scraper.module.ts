import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';
import { Location } from './location.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Location])],
  controllers: [ScraperController],
  providers: [ScraperService],
})
export class ScraperModule {}
