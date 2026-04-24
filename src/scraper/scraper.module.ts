import { Module } from '@nestjs/common';
import { ScraperController } from './scraper.controller';
import { ScraperService } from './scraper.service';
import { GoogleMapsScraperService } from './multiService/GoogleMapsScraper.service';
import { YelpScraperService } from './multiService/yelpScaper.service';
import { BingScraperService } from './multiService/bingScraper.service';
import { N49ScraperService } from './multiService/n49Scraper.service';
import { MapQuestScraperService } from './multiService/mapquestScraper.service';
import { OpendiScraperService } from './multiService/opendiScraper.service';
import { ProfileCanadaScraperService } from './multiService/profileCanada.service';
import { InstagramScraperService } from './demoService/instagramScrapper.service';
import { WhereToScraperService } from './demoService/wheretoScraper.service';
import { HotfrogScraperService } from './demoService/hotfrogScraper.service';
import { FacebookScraperService } from './demoService/facebookScraper.service';
import { IGlobalScraperService } from './multiService/iGlobalScraper.service';
import { GoLocalScraperService } from './demoService/goLocal247Scrapper.service';
import { MerchantCircleScraperService } from './demoService/merchantCircleScraper.service';
// import { CylexScraperService } from './multiService/cylexScraper.service';
// import { BrownbookScraperService } from './multiService/brownbookScraper.service';
// import { InfobelScraperService } from './multiService/infobelScraper.service';

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
  ],
})
export class ScraperModule {}
