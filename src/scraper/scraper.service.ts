/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from './dto/location-response.dto';
import { GoogleMapsScraperService } from './multiService/GoogleMapsScraper.service';
import { YelpScraperService } from './multiService/yelpScaper.service';
// import { N49ScraperService } from '../scraper/multiService/n49Scraper.service';
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
    // private n49Service: N49ScraperService,
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
    location: string,
    phone: string,
  ): Promise<LocationResponseDto[]> {
    // await this.locationRepo.clear();

    const [
      googleData,
      yelpData,
      // N49ScraperData,
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
      // this.n49Service.scrapeN49(name, location),
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
      // ...N49ScraperData,
      ...mapquestData,
      ...opendiData,
      ...profileCanadaData,
      ...instagramData,
      ...wheretoData,
      ...hotfrogData,
      ...facebookData,
      ...iglobalData,
    ];

    if (phone && phone.trim() !== '') {
      console.log('Phone state:', phone);
      return combinedData.map((item) => ({
        ...item,
        audit: this.checkNAPMatch(item, name, phone, location),
      }));
    }

    return combinedData;
  }

  checkNAPMatch(
    scraped: any,
    inputName: string,
    inputPhone: string,
    inputLocation: string,
  ) {
    console.log(
      'Checking NAP for:',
      scraped.name,
      scraped.phone,
      scraped.address,
    );
    const checkAddressMatch = (scrapedAddr: string, inputAddr: string) => {
      if (!scrapedAddr || !inputAddr) return false;

      const sAddr = scrapedAddr.toLowerCase();
      const iAddr = inputAddr.toLowerCase();

      if (sAddr.includes(iAddr) || iAddr.includes(sAddr)) return true;
      const inputParts = iAddr
        .split(/[\s,]+/)
        .filter((part) => part.length > 2);
      if (inputParts.length === 0) return false;

      const matches = inputParts.filter((part) => sAddr.includes(part));
      return matches.length / inputParts.length >= 0.6;
    };

    // NestJS: ScraperService.ts

    const cleanPhone = (p: string) => {
      console.log('p', p);
      if (!p) return '';
      const digits = p.replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : digits;
    };

    const inputPhoneClean = cleanPhone(inputPhone);
    const scrapedPhoneClean = cleanPhone(scraped.phone);

    const cleanStr = (s: string) =>
      s?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
    // Name Match
    const isNameMatch =
      cleanStr(scraped.name).includes(cleanStr(inputName)) ||
      cleanStr(inputName).includes(cleanStr(scraped.name));

    // Phone Match (Actual digits only)
    const isPhoneMatch =
      inputPhoneClean !== '' && scrapedPhoneClean === inputPhoneClean;

    const isAddrMatch = checkAddressMatch(scraped.address, inputLocation);

    return {
      status:
        isNameMatch && isPhoneMatch && isAddrMatch ? 'Verified' : 'Mismatch',
      results: {
        name: isNameMatch ? scraped.name : '',
        phone: isPhoneMatch ? scraped.phone : '',
        address: isAddrMatch ? scraped.address : '',
      },
    };
  }
}
