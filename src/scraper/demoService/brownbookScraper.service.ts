import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Location } from '../location.entity';

@Injectable()
export class BrownbookScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeBrownbook(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: false, // important for stability
      slowMo: 100,
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/123 Safari/537.36',
    });

    const page = await context.newPage();

    try {
      // STEP 1: SEARCH PAGE
      const searchUrl = `https://www.brownbook.net/search/ca/all-cities/${encodeURIComponent(
        name,
      )}?page=1`;

      console.log(`[Brownbook] Searching: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });

      // Wait for results to appear
      await page.waitForSelector(`text=${name}`, { timeout: 15000 });

      // STEP 2: CLICK RESULT (KEY FIX)
      const result = page.locator(`text=${name}`).first();

      if (!(await result.count())) {
        console.error('No matching result found');
        return [];
      }

      await result.click();

      // Wait until navigated to business page
      await page.waitForURL(/\/business\//, { timeout: 50000 });

      const finalUrl = page.url();
      console.log(`Navigated to: ${finalUrl}`);

      //STEP 3: SCRAPE DATA
      await page.waitForSelector('p.text-3xl', { timeout: 15000 });

      const extracted = await page.evaluate(() => {
        const clean = (txt: string | null | undefined) =>
          txt ? txt.replace(/\s+/g, ' ').trim() : '-';

        // NAME
        const name = clean(document.querySelector('p.text-3xl')?.textContent);

        //ADDRESS (FIXED — from your DOM screenshot)
        let address = '-';

        const container = document.querySelector(
          'div.flex.flex-wrap.items-center',
        );

        if (container) {
          const text = Array.from(container.childNodes)
            .map((node) => node.textContent?.trim())
            .filter(Boolean)
            .join(' ');

          address = clean(text);
        }

        // PHONE (correct selector from your screenshot)
        const phone = clean(
          document.querySelector('#business-phone')?.textContent,
        );

        return {
          name,
          address,
          phone,
          locationLink: window.location.href,
        };
      });

      // 🧹 FILTER (same logic as your other scrapers)
      const keywords = name.toLowerCase().split(' ');
      const itemName = extracted.name.toLowerCase();

      const matchCount = keywords.filter((k) => itemName.includes(k)).length;

      if (matchCount < Math.ceil(keywords.length / 2)) {
        console.log(`[Brownbook] Filtered: ${extracted.name}`);
        return [];
      }

      const resultData: LocationResponseDto = {
        name: extracted.name,
        address: extracted.address,
        phone: extracted.phone,
        locationLink: extracted.locationLink,
        source: 'Brownbook',
        timestamp: new Date().toISOString(),
      };

      // SAVE TO DB
      // await this.saveResults([resultData]);

      return [resultData];
    } catch (error) {
      console.error('[Brownbook] Scraper Error:', (error as Error).message);
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
