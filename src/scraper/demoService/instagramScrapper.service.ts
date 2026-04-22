/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import { LocationResponseDto } from '../dto/location-response.dto';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';

@Injectable()
export class InstagramScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeInstagram(name: string): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true, // keep false for stability
    });

    //USE SAVED SESSION (VERY IMPORTANT)
    const context = await browser.newContext({
      storageState: 'ig-session.json',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 800 },
    });

    //Stealth fix
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => false,
      });
    });

    const page = await context.newPage();

    try {
      //STEP 1: GENERATE SLUGS
      const cleanName = name.toLowerCase();

      const variations = [
        cleanName.replace(/\s+/g, '_'),
        cleanName.replace(/\s+/g, ''),
        cleanName.replace(/[^a-z0-9]/g, ''),
        cleanName.replace('dental clinic', ''),
        cleanName.replace('clinic', ''),
        cleanName.replace('dental', ''),
        cleanName.split(' ')[0],
      ];

      //STEP 2: FIND PROFILE
      let profileLink: string | null = null;

      for (const slug of variations) {
        const url = `https://www.instagram.com/${slug}/`;

        console.log('[IG] Trying:', url);

        try {
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
          });

          await page.waitForTimeout(2000); // small delay

          const currentUrl = page.url();

          //skip login redirect
          if (currentUrl.includes('/accounts/login')) {
            continue;
          }

          const title = await page.title();

          if (
            !title.toLowerCase().includes('login') &&
            !title.toLowerCase().includes('sign up')
          ) {
            profileLink = url;
            console.log('[IG] Found profile:', profileLink);
            break;
          }
        } catch {
          continue;
        }
      }

      if (!profileLink) {
        console.log('[IG] No Instagram profile found');
        return [];
      }

      //STEP 3: OPEN PROFILE
      const profilePage = await context.newPage();

      await profilePage.goto(profileLink, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      await profilePage.waitForTimeout(4000);

      //STEP 4: EXTRACT DATA
      const data = await profilePage.evaluate(() => {
        const clean = (txt: any) =>
          txt ? txt.replace(/\s+/g, ' ').trim() : '-';

        // USERNAME
        const username = window.location.pathname.replace(/\//g, '');

        // NAME
        const name =
          document.querySelector('h1')?.textContent || document.title;

        // BIO
        let bio = '-';
        const bioEl = document.querySelector('section div span');

        if (bioEl) {
          bio = clean(bioEl.textContent);
        }

        return {
          username: clean(username),
          name: clean(name),
          bio,
          profileLink: window.location.href,
        };
      });

      // console.log('[IG] Extracted:', data);

      //STEP 5: MAP RESPONSE
      const result: LocationResponseDto = {
        name: data.username || data.name, //username as name
        address: data.bio || '-', //bio → address
        phone: '-', //required for DB
        locationLink: data.profileLink,
        source: 'Instagram',
        timestamp: new Date().toISOString(),
      };

      // await this.saveResults([result]);

      return [result];
    } catch (err) {
      console.error('[IG ERROR]', err);
      return [];
    } finally {
      await browser.close();
    }
  }

  // async saveResults(results: LocationResponseDto[]) {
  //   for (const item of results) {
  //     const existing = await this.locationRepo.findOne({
  //       where: { locationLink: item.locationLink },
  //     });

  //     if (!existing) {
  //       await this.locationRepo.save(this.locationRepo.create(item));
  //     } else {
  //       await this.locationRepo.update(existing.id, item);
  //     }
  //   }
  // }
}
