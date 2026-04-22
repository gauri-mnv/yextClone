import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from './dto/location-response.dto';
import { GoogleMapsScraperService } from './multiService/GoogleMapsScraper.service';
import { YelpScraperService } from '../scraper/multiService/yelpScaper.service';
import { N49ScraperService } from '../scraper/multiService/n49Scraper.service';
import { MapQuestScraperService } from '../scraper/multiService/mapquestScraper.service';
import { OpendiScraperService } from '../scraper/multiService/opendiScraper.service';
import { ProfileCanadaScraperService } from './multiService/profileCanada.service';
import { InstagramScraperService } from './demoService/instagramScrapper.service';
import { WhereToScraperService } from './demoService/wheretoScraper.service';
import { HotfrogScraperService } from './demoService/hotfrogScraper.service';
import { FacebookScraperService } from './demoService/facebookScraper.service';
import { IGlobalScraperService } from './multiService/iGlobalScraper.service';
// import { Location } from './location.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';

@Injectable()
export class ScraperService {
  constructor(
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
    private googleMapsScraperService: GoogleMapsScraperService,
    private yelpScraperService: YelpScraperService,
    private n49Service: N49ScraperService,
    private mapquestService: MapQuestScraperService,
    private opendiService: OpendiScraperService,
    private profileCanadaService: ProfileCanadaScraperService,
    private instagramService: InstagramScraperService,
    private wheretoScraperService: WhereToScraperService,
    private hotfrogScraperService: HotfrogScraperService,
    // private brownbookScraperService: BrownbookScraperService,
    private facebookScraperService: FacebookScraperService,
    private readonly iGlobalScraperService: IGlobalScraperService,
  ) {}

  async scrapeAllPlatforms(
    name: string,
    location: string = '',
  ): Promise<LocationResponseDto[]> {
    // await this.locationRepo.clear();

    const [
      googleData,
      yelpData,
      N49ScraperData,
      mapquestData,
      opendiData,
      profileCanadaData,
      instagramData,
      wheretoData,
      hotfrogData,
      facebookData,
      iglobalData,
    ] = await Promise.all([
      this.googleMapsScraperService.scrapeGoogleMaps(`${name} ${location}`),
      this.yelpScraperService.scrapeYelp(`${name} `, `${location}`),
      this.n49Service.scrapeN49(name, location),
      this.mapquestService.scrapeMapQuest(`${name} ${location}`),
      this.opendiService.scrapeOpendi(name, location),
      this.profileCanadaService.scrapeProfileCanada(name, location),
      this.instagramService.scrapeInstagram(name),
      this.wheretoScraperService.scrapeWhereTo(name, location),
      this.hotfrogScraperService.scrapeHotfrog(name, location),
      this.facebookScraperService.scrapeFacebook(name),
      this.iGlobalScraperService.scrapeIGlobal(name),
    ]);
    const combinedData = [
      ...googleData,
      ...yelpData,
      ...N49ScraperData,
      ...mapquestData,
      ...opendiData,
      ...profileCanadaData,
      ...instagramData,
      ...wheretoData,
      ...hotfrogData,
      ...facebookData,
      ...iglobalData,
    ];

    return combinedData;
  }
}
