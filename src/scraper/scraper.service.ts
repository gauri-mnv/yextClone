/* eslint-disable @typescript-eslint/no-unsafe-argument */
import { Injectable } from '@nestjs/common';
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
    // private bingScraperService: BingScraperService,
    private n49Service: N49ScraperService,
    private mapquestService: MapQuestScraperService,
    private opendiService: OpendiScraperService,
    private profileCanadaService: ProfileCanadaScraperService,
    private instagramService: InstagramScraperService,
    private wheretoScraperService: WhereToScraperService,
    private hotfrogScraperService: HotfrogScraperService,
    private facebookScraperService: FacebookScraperService,
    private readonly iGlobalScraperService: IGlobalScraperService,
    private goLocalScraperService: GoLocalScraperService,
    private merchantCircleScraperService: MerchantCircleScraperService,
    // private cylexScraperService: CylexScraperService,
    // private brownbookScraperService: BrownbookScraperService,
    // private infobelScraperService: InfobelScraperService,
    private myLocalServicesScraperService: MyLocalServicesScraperService,
  ) { }

  private async safeScrape(scraperPromise: Promise<any>, sourceName: string): Promise<any[]> {
    const defaultObj = {
      name: '',
      address: '',
      phone: '',
      locationLink: '',
      source: sourceName,
      timestamp: new Date().toISOString()
    };
    try {
      const result = await scraperPromise;
      if (!result || (Array.isArray(result) && result.length === 0)) {
        return [defaultObj];
      }
      const data = Array.isArray(result) ? result : [result];
      return data.map((item: any) => ({ ...item, source: sourceName }));
    } catch (error: any) {
      const errMsg = error?.message || 'Unknown error';
      console.error(`[Scraper Error] ${sourceName} failed: ${errMsg.split('\n')[0]}`);
      return [defaultObj];
    }
  }

  async scrapeAllPlatforms(
    name: string,
    location: string,
    phone: string,
  ): Promise<any[]> {
    // await this.locationRepo.clear();

    const results = await Promise.all([
      this.safeScrape(this.googleMapsScraperService.scrapeGoogleMaps(`${name} ${location}`), 'Google Maps'),
      this.safeScrape(this.yelpScraperService.scrapeYelp(`${name} `, `${location}`), 'Yelp'),
      // this.safeScrape(this.bingScraperService.scrapeBing(name, location), 'Bing'),
      this.safeScrape(this.n49Service.scrapeN49(name, location), 'N49'),
      this.safeScrape(this.mapquestService.scrapeMapQuest(`${name} ${location}`), 'MapQuest'),
      this.safeScrape(this.opendiService.scrapeOpendi(name, location), 'Opendi'),
      this.safeScrape(this.profileCanadaService.scrapeProfileCanada(name, location), 'Profile Canada'),
      this.safeScrape(this.instagramService.scrapeInstagram(name), 'Instagram'),
      this.safeScrape(this.wheretoScraperService.scrapeWhereTo(name, location), 'WhereTo'),
      this.safeScrape(this.hotfrogScraperService.scrapeHotfrog(name, location), 'Hotfrog'),
      this.safeScrape(this.facebookScraperService.scrapeFacebook(name), 'Facebook'),
      this.safeScrape(this.iGlobalScraperService.scrapeIGlobal(name), 'IGlobal'),
      this.safeScrape(this.goLocalScraperService.scrapeGoLocal(name, location), 'GoLocal247'),
      this.safeScrape(this.merchantCircleScraperService.scrapeMerchantCircle(name, location), 'MerchantCircle'),
      this.safeScrape(this.myLocalServicesScraperService.scrapeMyLocalServices(name, location), 'MyLocalServices'),
      // this.safeScrape(this.cylexScraperService.scrapeCylex(name, location), 'Cylex'),
      // this.safeScrape(this.brownbookScraperService.scrapeBrownbook(name, location), 'Brownbook'),
      // this.safeScrape(this.infobelScraperService.scrapeInfobel(name, location), 'Infobel'),
    ]);

    const combinedData = results.flat();

    return combinedData.map((item) => {
      const isEmpty = !item.name && !item.address && !item.phone;

      if (isEmpty) {
        return {
          scraped: {},
          meta: {
            source: item.source,
            locationLink: item.locationLink || '',
            timestamp: item.timestamp || new Date().toISOString()
          },
          audit: {
            status: 'Mismatch',
            results: {}
          }
        };
      }

      const auditResult = this.checkNAPMatch(item, name, phone, location);
      const isVerified = auditResult.status === 'Verified';

      return {
        scraped: isVerified ? {
          name: item.name || '',
          phone: item.phone || '',
          address: item.address || ''
        } : {},
        meta: {
          source: item.source,
          locationLink: item.locationLink || '',
          timestamp: item.timestamp || new Date().toISOString()
        },
        audit: auditResult
      };
    });
  }

  checkNAPMatch(
    scraped: any,
    inputName: string,
    inputPhone: string,
    inputLocation: string,
  ) {
    const checkAddressMatch = (scrapedAddr: any, inputAddr: any) => {
      if (!scrapedAddr || !inputAddr) return false;

      const sAddr = String(scrapedAddr).toLowerCase();
      const iAddr = String(inputAddr).toLowerCase();

      if (sAddr.includes(iAddr) || iAddr.includes(sAddr)) return true;
      const inputParts = iAddr
        .split(/[\s,]+/)
        .filter((part) => part.length > 2);
      if (inputParts.length === 0) return false;

      const matches = inputParts.filter((part) => sAddr.includes(part));
      return matches.length / inputParts.length >= 0.6;
    };

    const cleanPhone = (p: any) => {
      if (!p) return '';
      const strP = String(p);
      const digits = strP.replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : digits;
    };

    const inputPhoneClean = cleanPhone(inputPhone);
    const scrapedPhoneClean = cleanPhone(scraped.phone);

    const cleanStr = (s: any) =>
      s ? String(s).toLowerCase().replace(/[^a-z0-9]/g, '') : '';

    // Name Match
    const isNameMatch =
      cleanStr(scraped.name).includes(cleanStr(inputName)) ||
      cleanStr(inputName).includes(cleanStr(scraped.name));

    // Phone Match (Actual digits only)
    const isPhoneMatch =
      inputPhoneClean !== '' && scrapedPhoneClean === inputPhoneClean;

    const isAddrMatch = checkAddressMatch(scraped.address, inputLocation);

    let matchCount = 0;
    if (isNameMatch) matchCount++;
    if (isPhoneMatch) matchCount++;
    if (isAddrMatch) matchCount++;

    const isVerified = matchCount >= 2;

    return {
      status: isVerified ? 'Verified' : 'Mismatch',
      results: isVerified
        ? {
            name: scraped.name || '',
            phone: scraped.phone || '',
            address: scraped.address || ''
          }
        : {}
    };
  }
}
