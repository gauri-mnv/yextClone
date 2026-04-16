import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';
import { Location } from './location.entity';
import { GoogleMapsScraperService } from './GoogleMapsScraper.service';
import { YelpScraperService } from './yelpScaper.service';
import { BingScraperService } from './bingScraper.service';

@Module({
  imports: [TypeOrmModule.forFeature([Location])],
  controllers: [ScraperController],
  providers: [
    ScraperService,
    GoogleMapsScraperService,
    YelpScraperService,
    BingScraperService,
  ],
})
export class ScraperModule {}
