/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unsafe-return */

import { Injectable } from '@nestjs/common';
import {
  GoogleMapsScraperService,
  YelpScraperService,
  N49ScraperService,
  MapQuestScraperService,
  OpendiScraperService,
  ProfileCanadaScraperService,
  IGlobalScraperService,
  InfobelScraperService,
  // BrownbookScraperService,
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
    private infobelScraperService: InfobelScraperService,
    // private brownbookScraperService: BrownbookScraperService,
  ) {}

  private async syncWithDatabase(
    scrapedData: any,
    auditStatus: string,
  ): Promise<any> {
    // if (!scrapedData?.locationLink) return scrapedData;

    try {
      const existing: any = await this.locationRepo.findOne({
        where: { locationLink: scrapedData.locationLink },
      });

      const newData = {
        name: scrapedData.name || '',
        address: scrapedData.address || '',
        phone: scrapedData.phone || '',
        locationLink: scrapedData.locationLink || '',
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
      return data.map((item: any) => ({
        ...item,
        source: sourceName,
      }));
    } catch (error: any) {
      const errMsg = error?.message || 'Unknown error';
      console.error(
        `[Scraper Error] ${sourceName} failed: ${errMsg.split('\n')[0]}`,
      );
      return [defaultObj];
    }
  }

  // async scrapeAllPlatforms(
  //   name: string,
  //   location: string,
  //   phone: string,
  //   locationLink: string,
  //   onResultReady?: (data: any) => void,
  // ): Promise<any[]> {
  //   // Lazy factory array — wraps logic in executable scopes to protect process orchestration
  //   const taskFactories = [
  //     {
  //       run: () =>
  //         this.googleMapsScraperService.scrapeGoogleMaps(
  //           `${name} ${location} `,
  //         ),
  //       source: 'Google Maps',
  //     },
  //     {
  //       run: () =>
  //         this.yelpScraperService.scrapeYelp(`${name} `, `${location}`),
  //       source: 'Yelp',
  //     },
  //     {
  //       run: () => this.n49Service.scrapeN49(name, location),
  //       source: 'N49',
  //     },
  //     {
  //       run: () => this.mapquestService.scrapeMapQuest(`${name} ${location}`),
  //       source: 'MapQuest',
  //     },
  //     {
  //       run: () => this.opendiService.scrapeOpendi(name, location),
  //       source: 'Opendi',
  //     },
  //     {
  //       run: () =>
  //         this.profileCanadaService.scrapeProfileCanada(name, location),
  //       source: 'Profile Canada',
  //     },
  //     {
  //       run: () => this.instagramService.scrapeInstagram(name),
  //       source: 'Instagram',
  //     },
  //     {
  //       run: () => this.wheretoScraperService.scrapeWhereTo(name, location),
  //       source: 'WhereTo',
  //     },
  //     {
  //       run: () => this.hotfrogScraperService.scrapeHotfrog(name, location),
  //       source: 'Hotfrog',
  //     },
  //     {
  //       run: () => this.facebookScraperService.scrapeFacebook(name),
  //       source: 'Facebook',
  //     },
  //     {
  //       run: () => this.iGlobalScraperService.scrapeIGlobal(name),
  //       source: 'IGlobal',
  //     },
  //     {
  //       run: () => this.goLocalScraperService.scrapeGoLocal(name, location),
  //       source: 'GoLocal247',
  //     },
  //     {
  //       run: () =>
  //         this.merchantCircleScraperService.scrapeMerchantCircle(
  //           name,
  //           location,
  //         ),
  //       source: 'MerchantCircle',
  //     },
  //     {
  //       run: () => this.infobelScraperService.scrapeInfobel(name, location),
  //       source: 'Infobel',
  //     },
  //   ];

  //   const processTask = async (task: {
  //     run: () => Promise<any>;
  //     source: string;
  //   }) => {
  //     // Execute factory right here so initialization happens safely within its own runtime block
  //     const resultsArray = await this.safeScrape(task.run(), task.source);
  //     const item = resultsArray[0];

  //     const isEmpty = !item.name && !item.address && !item.phone;
  //     const auditResult = this.checkNAPMatch(item, name, phone, location);
  //     const syncedData = await this.syncWithDatabase(item, auditResult.status);

  //     let finalResult;

  //     if (isEmpty) {
  //       finalResult = {
  //         scraped: { name: '', phone: '', address: '' },
  //         meta: {
  //           source: item.source,
  //           locationLink: item.locationLink || '',
  //           timestamp: new Date().toISOString(),
  //         },
  //         audit: {
  //           status: 'Mismatch',
  //           results: { name: '', phone: '', address: '' },
  //           matched: { name: false, phone: false, address: false },
  //           score: 0,
  //         },
  //       };
  //     } else {
  //       finalResult = {
  //         scraped:
  //           auditResult.status === 'Verified'
  //             ? { name: item.name, phone: item.phone, address: item.address }
  //             : {},
  //         meta: {
  //           source: item.source,
  //           locationLink: item.locationLink || '',
  //           timestamp: syncedData.foundAt || new Date().toISOString(),
  //         },
  //         audit: auditResult,
  //       };
  //     }

  //     if (onResultReady) {
  //       onResultReady(finalResult);
  //     }
  //     return finalResult;
  //   };

  //   // Resolves smoothly without engine memory leaks or inter-process target contamination
  //   return Promise.all(taskFactories.map((task) => processTask(task)));
  // }

  async scrapeAllPlatforms(
    name: string,
    location: string,
    phone: string,
    locationLink: string,
    onResultReady?: (data: any) => void,
  ): Promise<any[]> {
    // 1. Define our factory array (wrapped execution scopes)
    const taskFactories = [
      {
        run: () =>
          this.googleMapsScraperService.scrapeGoogleMaps(
            `${name} ${location} `,
          ),
        source: 'Google Maps',
      },
      {
        run: () =>
          this.yelpScraperService.scrapeYelp(`${name} `, `${location}`),
        source: 'Yelp',
      },
      { run: () => this.n49Service.scrapeN49(name, location), source: 'N49' },
      {
        run: () => this.mapquestService.scrapeMapQuest(`${name} ${location}`),
        source: 'MapQuest',
      },
      {
        run: () => this.opendiService.scrapeOpendi(name, location),
        source: 'Opendi',
      },
      {
        run: () =>
          this.profileCanadaService.scrapeProfileCanada(name, location),
        source: 'Profile Canada',
      },
      {
        run: () => this.instagramService.scrapeInstagram(name),
        source: 'Instagram',
      },
      {
        run: () => this.wheretoScraperService.scrapeWhereTo(name, location),
        source: 'WhereTo',
      },
      {
        run: () => this.hotfrogScraperService.scrapeHotfrog(name, location),
        source: 'Hotfrog',
      },
      {
        run: () => this.facebookScraperService.scrapeFacebook(name),
        source: 'Facebook',
      },
      {
        run: () => this.iGlobalScraperService.scrapeIGlobal(name),
        source: 'IGlobal',
      },
      {
        run: () => this.goLocalScraperService.scrapeGoLocal(name, location),
        source: 'GoLocal247',
      },
      {
        run: () =>
          this.merchantCircleScraperService.scrapeMerchantCircle(
            name,
            location,
          ),
        source: 'MerchantCircle',
      },
      {
        run: () => this.infobelScraperService.scrapeInfobel(name, location),
        source: 'Infobel',
      },
      // {
      //   run: () => this.brownbookScraperService.scrapeBrownbook(name),
      //   source: 'Brownbook',
      // },
    ];

    const results: any[] = new Array(taskFactories.length);

    // 2. Setup structural processing tracking
    let currentIndex = 0;
    const CONCURRENCY_LIMIT = 3; // 🔥 Maximum number of browsers allowed to run at the same time

    const worker = async () => {
      while (currentIndex < taskFactories.length) {
        const index = currentIndex++;
        const task = taskFactories[index];

        // Execute task pipeline safely isolated inside worker allocation
        const resultsArray = await this.safeScrape(task.run(), task.source);
        const item = resultsArray[0];

        const isEmpty = !item.name && !item.address && !item.phone;
        const auditResult = this.checkNAPMatch(item, name, phone, location);
        const syncedData = await this.syncWithDatabase(
          item,
          auditResult.status,
        );

        let finalResult;
        if (isEmpty) {
          finalResult = {
            scraped: { name: '', phone: '', address: '' },
            meta: {
              source: item.source,
              locationLink: item.locationLink || '',
              timestamp: new Date().toISOString(),
            },
            audit: {
              status: 'Mismatch',
              results: { name: '', phone: '', address: '' },
              matched: { name: false, phone: false, address: false },
              score: 0,
            },
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

        results[index] = finalResult;
      }
    };

    // 3. Fire up the concurrent worker pool workers
    const workers = Array.from({ length: CONCURRENCY_LIMIT }, () => worker());
    await Promise.all(workers);

    return results;
  }

  checkNAPMatch(
    scraped: any,
    inputName: string,
    inputPhone: string,
    inputLocation: string,
  ) {
    const checkNameMatch = (scrapedName: any, inputName: any) => {
      if (!scrapedName || !inputName) return false;
      const sName = String(scrapedName).toLowerCase();
      const iName = String(inputName).toLowerCase();
      if (sName.includes(iName) || iName.includes(sName)) return true;

      const inputParts = iName
        .split(/[\s,]+/)
        .filter((part) => part.length >= 2);
      if (inputParts.length === 0) return false;

      const matches = inputParts.filter((part) => sName.includes(part));
      return matches.length / inputParts.length >= 0.4;
    };

    const checkAddressMatch = (scrapedAddr: any, inputAddr: any) => {
      if (!scrapedAddr || !inputAddr) return false;

      const sAddr = String(scrapedAddr).toLowerCase();
      const iAddr = String(inputAddr).toLowerCase();

      if (sAddr.includes(iAddr) || iAddr.includes(sAddr)) return true;
      const inputParts = iAddr
        .split(/[\s,]+/)
        .filter((part) => part.length >= 2);
      if (inputParts.length === 0) return false;

      const matches = inputParts.filter((part) => sAddr.includes(part));
      return matches.length / inputParts.length >= 0.4;
    };

    const cleanPhone = (p: any) => {
      if (!p) return '';
      const strP = String(p);
      const digits = strP.replace(/\D/g, '');
      return digits.length >= 10 ? digits.slice(-10) : digits;
    };

    const inputPhoneClean = cleanPhone(inputPhone);
    const scrapedPhoneClean = cleanPhone(scraped.phone);

    const isNameMatch = checkNameMatch(scraped.name, inputName);
    const safeScraped = scraped || {};
    const isPhoneMatch =
      inputPhoneClean !== '' && scrapedPhoneClean === inputPhoneClean;
    const isAddrMatch = checkAddressMatch(scraped.address, inputLocation);

    let matchCount = 0;
    let score = 0;
    if (isNameMatch) matchCount++;
    if (isPhoneMatch) matchCount++;
    if (isAddrMatch) matchCount++;

    const isVerified = matchCount >= 2;
    if (matchCount > 0) {
      score = Math.round((matchCount / 3) * 100);
    }

    return {
      status: isVerified ? 'Verified' : 'Mismatch',
      results: {
        name: safeScraped.name || '',
        phone: safeScraped.phone || '',
        address: safeScraped.address || '',
      },
      matched: {
        name: !!isNameMatch,
        phone: !!isPhoneMatch,
        address: !!isAddrMatch,
      },
      score: score,
    };
  }
}
