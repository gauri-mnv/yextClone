import { Module } from '@nestjs/common';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';
import { Location } from './location.entity';
import {
  GoogleMapsScraperService,
  YelpScraperService,
  N49ScraperService,
  MapQuestScraperService,
  OpendiScraperService,
  ProfileCanadaScraperService,
  IGlobalScraperService,
  InfobelScraperService,
  AcompioScraperService,
  AppleMapsScraperService,
  OpenStreetMapScraperService,
  KompassScraperService,
  StoreboardScraperService,
  ZeemapsScraperService,
  IbeginScraperService,
  BizpagesScraperService,
  //BrownbookScraperService,
} from './multiService';
import {
  InstagramScraperService,
  WhereToScraperService,
  HotfrogScraperService,
  FacebookScraperService,
  GoLocalScraperService,
  MerchantCircleScraperService,
} from './demoService';
import { VisionAiService, CaptchaSolverService } from './captchaSolver';
import { ScraperGateway } from './scraper.gateway';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forFeature([Location])],
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
    AcompioScraperService,
    AppleMapsScraperService,
    OpenStreetMapScraperService,
    KompassScraperService,
    StoreboardScraperService,
    ZeemapsScraperService,
    IbeginScraperService,
    BizpagesScraperService,
    //BrownbookScraperService,
    // CylexScraperService,
    InfobelScraperService,
    VisionAiService,
    CaptchaSolverService,
  ],
})
export class ScraperModule {}
