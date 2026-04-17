import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';
import { Location } from './location.entity';
import { GoogleMapsScraperService } from './multiService/GoogleMapsScraper.service';
import { YelpScraperService } from './multiService/yelpScaper.service';
import { BingScraperService } from './multiService/bingScraper.service';
import { InstagramScraperService } from './multiService/instagramScraper.service';
import { N49ScraperService } from './multiService/n49Scraper.service';
import { MapQuestScraperService } from './multiService/mapquestScraper.service';

@Module({
  imports: [TypeOrmModule.forFeature([Location])],
  controllers: [ScraperController],
  providers: [
    ScraperService,
    GoogleMapsScraperService,
    YelpScraperService,
    BingScraperService,
    InstagramScraperService,
    N49ScraperService,
    MapQuestScraperService,
  ],
})
export class ScraperModule {}
