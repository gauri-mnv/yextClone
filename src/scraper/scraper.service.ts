import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from './dto/location-response.dto';
import { GoogleMapsScraperService } from './multiService/GoogleMapsScraper.service';
import { YelpScraperService } from '../scraper/multiService/yelpScaper.service';
import { N49ScraperService } from '../scraper/multiService/n49Scraper.service';
import { MapQuestScraperService } from '../scraper/multiService/mapquestScraper.service';
import { OpendiScraperService } from '../scraper/multiService/opendiScraper.service';
import { ProfileCanadaScraperService } from './multiService/profileCanada.service';
import { IGlobalScraperService } from './multiService/iGlobalScraper.service';
// import { BingScraperService } from '../scraper/multiService/bingScraper.service';
// import { InstagramScraperService } from '../scraper/multiService/instagramScraper.service';
// import { CylexScraperService } from './multiService/cylexScraper.service';
// import { BrownbookScraperService } from './multiService/brownbookScraper.service';
// import { InfobelScraperService } from './multiService/infobelScraper.service';

import { Location } from './location.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class ScraperService {
  constructor(
    @InjectRepository(Location)
    private locationRepo: Repository<Location>,
    private googleMapsScraperService: GoogleMapsScraperService,
    private yelpScraperService: YelpScraperService,
    private n49Service: N49ScraperService,
    private mapquestService: MapQuestScraperService,
    private opendiService: OpendiScraperService,
    private profileCanadaService: ProfileCanadaScraperService,
    private iGlobalScraperService: IGlobalScraperService,

    // private cylexService: CylexScraperService,
    // private bingService: BingScraperService,
    // private instagramService: InstagramScraperService,
    // private brownbookScraperService: BrownbookScraperService,
    // private infobelScraperService: InfobelScraperService,
  ) {}

  //combine
  async scrapeAllPlatforms(
    name: string,
    location: string = '',
  ): Promise<LocationResponseDto[]> {
    await this.locationRepo.clear();
    // console.log(`🚀 Starting Multi-Platform Scraping for: ${name}`);

    const [
      googleData,
      yelpData,
      N49ScraperData,
      mapquestData,
      opendiData,
      profileCanadaData,
      iGlobalData,
      // cylexData,
      // brownbookData,
      // infobelData,
    ] = await Promise.all([
      this.googleMapsScraperService.scrapeGoogleMaps(`${name} ${location}`),
      this.yelpScraperService.scrapeYelp(`${name} `, `${location}`),
      this.n49Service.scrapeN49(name, location),
      this.mapquestService.scrapeMapQuest(`${name} ${location}`),
      this.opendiService.scrapeOpendi(name, location),
      this.profileCanadaService.scrapeProfileCanada(name, location),
      this.iGlobalScraperService.scrapeIGlobal(name),
      // this.cylexService.scrapeCylex(name, location),
      // this.brownbookScraperService.scrapeBrownbook(name, location),
      // this.infobelScraperService.scrapeInfobel(name, location),
    ]);
    const combinedData = [
      ...googleData,
      ...yelpData,
      ...N49ScraperData,
      ...mapquestData,
      ...opendiData,
      ...profileCanadaData,
      ...iGlobalData,
      // ...cylexData,
      // ...brownbookData,
      // ...infobelData,
    ];
    console.log(
      `📊 Total Results Found: ${combinedData.length} 
      (Google: ${googleData.length}, 
      Yelp: ${yelpData.length},
      mapquestData:${mapquestData.length},
     N49Scraper:${N49ScraperData.length},
      Opendi:${opendiData.length},
         profileCanadaService:${profileCanadaData.length},
        iGlobal:${iGlobalData.length},

        Cylex:${0},
       brownbookData:${0},
       infobelData:${0}`,
    );

    return combinedData;
  }
}
