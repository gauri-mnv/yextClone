/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Injectable } from '@nestjs/common';
// import { LocationResponseDto } from './dto/location-response.dto';
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
} from './demoService';
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
    private infobelScraperService: InfobelScraperService,
  ) {}

  private async syncWithDatabase(
    scrapedData: any,
    auditStatus: string,
  ): Promise<any> {
    if (!scrapedData?.locationLink) return scrapedData;

    try {
      const existing: any = await this.locationRepo.findOne({
        where: { locationLink: scrapedData.locationLink },
      });

      const newData = {
        name: scrapedData.name || '',
        address: scrapedData.address || '',
        phone: scrapedData.phone || '',
        locationLink: scrapedData.locationLink,
        source: scrapedData.source,
        status: auditStatus,
      };
      if (existing) {
        const hasChanged =
          existing.name !== newData.name ||
          existing.address !== newData.address ||
          existing.phone !== newData.phone ||
          existing.status !== newData.status;

        if (hasChanged) {
          const updated = await this.locationRepo.save({
            ...existing,
            ...newData,
          });
          return {
            ...updated,
            timestamp: updated.foundAt.toISOString(),
          };
        }
        return {
          ...existing,
          timestamp: existing.foundAt.toISOString(),
          status: existing.status,
        };
      } else {
        const saved = await this.locationRepo.save(
          this.locationRepo.create(newData),
        );
        return {
          ...saved,
          timestamp: saved.foundAt.toISOString(),
        };
      }
    } catch (error) {
      console.error(
        `[Sync Error] ${scrapedData.source} Failed to sync with database: ${error}`,
      );
      return scrapedData;
    }
  }
  private async safeScrape(
    scraperPromise: Promise<any>,
    sourceName: string,
  ): Promise<any[]> {
    const defaultObj = {
      name: '',
      address: '',
      phone: '',
      locationLink: '',
      source: sourceName,
      status: 'Pending',
      timestamp: new Date().toISOString(),
    };
    try {
      const result = await scraperPromise;
      if (!result || (Array.isArray(result) && result.length === 0)) {
        return [defaultObj];
      }
      const data = Array.isArray(result) ? result : [result];
      const itemsWithSource = data.map((item: any) => ({
        ...item,
        source: sourceName,
      }));

      // const syncedData = await Promise.all(
      //   itemsWithSource.map((item: any) => this.syncWithDatabase(item, 'Pending')),
      // );
      return itemsWithSource;
    } catch (error: any) {
      const errMsg = error?.message || 'Unknown error';
      console.error(
        `[Scraper Error] ${sourceName} failed: ${errMsg.split('\n')[0]}`,
      );
      return [defaultObj];
    }
  }

  async scrapeAllPlatforms(
    name: string,
    location: string,
    phone: string,
    onResultReady?: (data: any) => void,
  ): Promise<any[]> {
    // await this.locationRepo.clear();

    const tasks = [
      {
        promise: this.googleMapsScraperService.scrapeGoogleMaps(
          `${name} ${location}`,
        ),
        source: 'Google Maps',
      },
      {
        promise: this.yelpScraperService.scrapeYelp(`${name} `, `${location}`),
        source: 'Yelp',
      },
      { promise: this.n49Service.scrapeN49(name, location), source: 'N49' },
      {
        promise: this.mapquestService.scrapeMapQuest(`${name} ${location}`),
        source: 'MapQuest',
      },
      {
        promise: this.opendiService.scrapeOpendi(name, location),
        source: 'Opendi',
      },
      {
        promise: this.profileCanadaService.scrapeProfileCanada(name, location),
        source: 'Profile Canada',
      },
      {
        promise: this.instagramService.scrapeInstagram(name),
        source: 'Instagram',
      },
      {
        promise: this.wheretoScraperService.scrapeWhereTo(name, location),
        source: 'WhereTo',
      },
      {
        promise: this.hotfrogScraperService.scrapeHotfrog(name, location),
        source: 'Hotfrog',
      },
      {
        promise: this.facebookScraperService.scrapeFacebook(name),
        source: 'Facebook',
      },
      {
        promise: this.iGlobalScraperService.scrapeIGlobal(name),
        source: 'IGlobal',
      },
      {
        promise: this.goLocalScraperService.scrapeGoLocal(name, location),
        source: 'GoLocal247',
      },
      {
        promise: this.merchantCircleScraperService.scrapeMerchantCircle(
          name,
          location,
        ),
        source: 'MerchantCircle',
      },
      // { promise: this.cylexScraperService.scrapeCylex(name, location), source: 'Cylex' },
      // { promise: this.brownbookScraperService.scrapeBrownbook(name, location), source: 'Brownbook' },
      {
        promise: this.infobelScraperService.scrapeInfobel(name, location),
        source: 'Infobel',
      },
    ];

    const processTask = async (task: {
      promise: Promise<any>;
      source: string;
    }) => {
      const resultsArray = await this.safeScrape(task.promise, task.source);
      const item = resultsArray[0];

      // Aapka existing formatting logic
      const isEmpty = !item.name && !item.address && !item.phone;
      const auditResult = this.checkNAPMatch(item, name, phone, location);

      const syncedData = await this.syncWithDatabase(item, auditResult.status);

      let finalResult;

      if (isEmpty) {
        finalResult = {
          scraped: {},
          meta: {
            source: item.source,
            locationLink: item.locationLink || '',
            timestamp: new Date().toISOString(),
          },
          audit: { status: 'Mismatch', results: {} },
        };
      } else {
        finalResult = {
          scraped:
            auditResult.status === 'Verified'
              ? { name: item.name, phone: item.phone, address: item.address }
              : {},
          meta: {
            source: item.source,
            locationLink: item.locationLink || '',
            timestamp: syncedData.foundAt || new Date().toISOString(),
          },
          audit: auditResult,
        };
      }
      if (onResultReady) {
        onResultReady(finalResult);
      }
      console.log(`Result from ${task.source}:`, finalResult);
      return finalResult;
    };

    // all tasks in parallel mein
    return Promise.all(tasks.map((task) => processTask(task)));
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
      s
        ? String(s)
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '')
        : '';

    // Name Match
    const isNameMatch =
      cleanStr(scraped.name).includes(cleanStr(inputName)) ||
      cleanStr(inputName).includes(cleanStr(scraped.name));
    const safeScraped = scraped || {};
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
      results: {
        name: safeScraped.name || '',
        phone: safeScraped.phone || '',
        address: safeScraped.address || '',
      },
      matched: {
        // These will naturally be false if the fields are missing
        name: !!isNameMatch,
        phone: !!isPhoneMatch,
        address: !!isAddrMatch,
      },
    };
  }
}
