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



@Module({
  // imports: [TypeOrmModule.forFeature([Location])],
  controllers: [ScraperController],
  providers: [
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
  ],
})
export class ScraperModule {}
