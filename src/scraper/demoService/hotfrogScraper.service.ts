import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';

@Injectable()
export class HotfrogScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeHotfrog(
    name: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    });

    const page = await context.newPage();

    try {
      // STEP 1: SEARCH
      const slug = name.toLowerCase().replace(/\s+/g, '-');
      const searchUrl = `https://www.hotfrog.ca/search/ca/${slug}`;

      console.log(`[Hotfrog] Searching: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await page.waitForTimeout(3000);

      // STEP 2: FIND BUSINESS LINK
      const links = await page.locator('a[href*="/company/"]').all();

      let targetLink: string | null = null;

      for (const link of links) {
        const text = (await link.textContent())?.toLowerCase() || '';

        if (text.includes(name.toLowerCase())) {
          const href = await link.getAttribute('href');

          if (href) {
            targetLink = href.startsWith('http')
              ? href
              : `https://www.hotfrog.ca${href}`;

            console.log(`[Hotfrog] Found link: ${targetLink}`);
            break;
          }
        }
      }

      if (!targetLink) {
        console.error('[Hotfrog] No matching business found');
        return [];
      }

      // STEP 3: OPEN DETAIL PAGE
      const detailPage = await context.newPage();

      await detailPage.goto(targetLink, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      await detailPage.waitForSelector('h1', { timeout: 15000 });

      // STEP 4: EXTRACT DATA (FINAL STRUCTURED VERSION)
      const extracted = await detailPage.evaluate(() => {
        const clean = (txt: string | null | undefined) =>
          txt ? txt.replace(/\s+/g, ' ').trim() : '-';

        //NAME
        const name = clean(document.querySelector('h1')?.textContent);

        // PHONE (dt → dd structure)
        let phone = '-';
        const phoneLabel = Array.from(document.querySelectorAll('dt')).find(
          (el) => el.textContent?.toLowerCase().includes('phone'),
        );

        if (phoneLabel) {
          const phoneValue = phoneLabel.nextElementSibling;
          if (phoneValue) {
            phone = clean(phoneValue.textContent);
          }
        }

        // ADDRESS (structured attributes)
        const line1 = document.querySelector(
          '[data-address-line1]',
        )?.textContent;
        const town = document.querySelector('[data-address-town]')?.textContent;
        const county = document.querySelector(
          '[data-address-county]',
        )?.textContent;
        const postcode = document.querySelector(
          '[data-address-postcode]',
        )?.textContent;

        let address = '-';

        const parts = [line1, town, county, postcode]
          .map((p) => p?.trim())
          .filter(Boolean);

        if (parts.length) {
          address = parts.join(', ');
        }

        return {
          name,
          address,
          phone,
          locationLink: window.location.href,
        };
      });

      // FILTER (same logic as your other scrapers)
      const keywords = name.toLowerCase().split(' ');
      const itemName = extracted.name.toLowerCase();

      const matchCount = keywords.filter((k) => itemName.includes(k)).length;

      if (matchCount < Math.ceil(keywords.length / 2)) {
        console.log(`[Hotfrog] Filtered: ${extracted.name}`);
        return [];
      }

      const result: LocationResponseDto = {
        name: extracted.name,
        address: extracted.address,
        phone: extracted.phone,
        locationLink: extracted.locationLink,
        source: 'Hotfrog',
        timestamp: new Date().toISOString(),
      };

      // SAVE
      // await this.saveResults([result]);

      return [result];
    } catch (error) {
      console.error('[Hotfrog] Scraper Error:', (error as Error).message);
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
