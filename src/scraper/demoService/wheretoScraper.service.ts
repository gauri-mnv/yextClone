/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';

@Injectable()
export class WhereToScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeWhereTo(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // DIRECT POI URL (as per your requirement)
      const poiUrl = 'https://wheretoapp.com/search?poi=7046012492850146445';

      console.log(`[WhereTo] Opening: ${poiUrl}`);

      await page.goto(poiUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      // Wait for page to load
      await page.waitForSelector('h1', { timeout: 15000 });

      // Extract data
      const extracted = await page.evaluate(() => {
        const clean = (txt: string | null | undefined) =>
          txt ? txt.replace(/\s+/g, ' ').trim() : '-';

        // NAME
        const name = clean(document.querySelector('h1')?.textContent);

        // ADDRESS (clean + formatted)
        let address = '-';
        const addressEl = document.querySelector('#address');

        if (addressEl) {
          // Try structured extraction first
          const parts = Array.from(addressEl.querySelectorAll('div, span'))
            .map((el) => el.textContent?.trim())
            .filter(Boolean)
            .filter((text) => !/Get Directions/i.test(text));

          if (parts.length) {
            address = parts.join(', ');
          } else {
            // fallback
            let text = addressEl.textContent || '';

            text = text
              .replace(/Get Directions/i, '')
              .replace(/([a-zA-Z])(\d)/g, '$1 $2')
              .replace(/\s+/g, ' ')
              .trim();

            address = text;
          }
        }

        //PHONE
        let phone = '-';
        const phoneEl =
          document.querySelector('a[href^="tel:"]') ||
          document.querySelector('[class*="phone"]');

        if (phoneEl) {
          phone = clean(phoneEl.textContent);
        }

        return {
          name,
          address,
          phone,
          locationLink: window.location.href,
        };
      });

      //Safety check
      if (!extracted.name || extracted.name === '-') {
        return [];
      }

      const result: LocationResponseDto = {
        name: extracted.name,
        address: extracted.address,
        phone: extracted.phone,
        locationLink: extracted.locationLink,
        source: 'WhereTo',
        timestamp: new Date().toISOString(),
      };

      //Save to DB
      // await this.saveResults([result]);

      return [result];
    } catch (error) {
      console.error('[WhereTo] Scraper Error:', (error as Error).message);
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
