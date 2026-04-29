import { Module } from '@nestjs/common';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';
import {
  GoogleMapsScraperService,
  YelpScraperService,
  N49ScraperService,
  MapQuestScraperService,
  OpendiScraperService,
  ProfileCanadaScraperService,
  IGlobalScraperService,
  InfobelScraperService,
} from './multiService';
import {
  InstagramScraperService,
  WhereToScraperService,
  HotfrogScraperService,
  FacebookScraperService,
  GoLocalScraperService,
  MerchantCircleScraperService,
  MyLocalServicesScraperService,
} from './demoService';
import { ScraperGateway } from './scraper.gateway';

@Module({
  // imports: [TypeOrmModule.forFeature([Location])],
  controllers: [ScraperController],
  providers: [
    ScraperGateway,
    ScraperService,
    GoogleMapsScraperService,
    YelpScraperService,
    // BingScraperService,
    N49ScraperService,
    InstagramScraperService,
    MapQuestScraperService,
    OpendiScraperService,
    ProfileCanadaScraperService,
    WhereToScraperService,
    HotfrogScraperService,
    FacebookScraperService,
    IGlobalScraperService,
    GoLocalScraperService,
    MerchantCircleScraperService,
    // BrownbookScraperService,
    // CylexScraperService,
    // InfobelScraperService,
    MyLocalServicesScraperService,
    InfobelScraperService,
  ],
})
export class ScraperModule {}
