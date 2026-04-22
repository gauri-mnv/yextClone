/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { Location } from '../location.entity';
// import { Repository } from 'typeorm';
// import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class BingScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }
  async scrapeBing(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({});
    const page = await context.newPage();

    try {
      const searchQuery = encodeURIComponent(`${name} ${location}`);
      const searchUrl = `https://www.bing.com/search?q=${searchQuery}`;

      await page.goto(searchUrl, { waitUntil: 'load', timeout: 30000 });
      try {
        await page.waitForSelector('li.b_algo', {
          state: 'attached',
          timeout: 5000,
        });
      } catch (e) {
        console.warn(`⚠️ Bing took too long, trying to scrape anyway... ${e}`);
      }
      const results = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('li.b_algo'));

        return items
          .map((item) => {
            const nameEl = item.querySelector('h2 a') as HTMLAnchorElement;
            const snippetEl = item.querySelector(
              '.b_caption p, .b_snippet,.b_linefull',
            );

            if (!nameEl) return null;

            const name = nameEl.innerText || '';
            const link = nameEl.href || '';

            const snippet = snippetEl?.textContent || ' ';
            const phoneMatch = snippet.match(
              /\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/,
            );
            const phone = phoneMatch ? phoneMatch[0] : '';
            return {
              name: name.trim(),
              address:
                snippet.length > 10
                  ? snippet.substring(0, 100) + '...'
                  : 'See link',
              phone: phone,
              locationLink: link,
            };
          })
          .filter((i) => i !== null);
      });

      return results.map((item) => ({
        ...item,
        source: 'Bing',
        timestamp: new Date().toISOString(),
      }));
    } catch (error) {
      console.error(`❌ Bing Scraper Error: ${error}`);
      return [];
    } finally {
      await browser.close();
    }
  }

  // async saveResults(results: LocationResponseDto[], targetName: string) {
  //   const searchKeywords = targetName.toLowerCase().split(' ');

  //   for (const item of results) {
  //     if (!item.name) continue;

  //     // 2. Strict Match Check: Kam se kam 2 keywords match hone chahiye
  //     const itemName = item.name.toLowerCase();
  //     const matchCount = searchKeywords.filter((key) =>
  //       itemName.includes(key),
  //     ).length;
  //     if (matchCount < Math.ceil(searchKeywords.length / 2)) {
  //       // console.log(`🚫 Filtering out unrelated result: ${item.name}`);
  //       continue;
  //     }
  //     const existing = await this.locationRepo.findOne({
  //       where: { locationLink: item.locationLink },
  //     });
  //     if (!existing) {
  //       const newLocation = this.locationRepo.create(item);
  //       await this.locationRepo.save(newLocation);
  //     } else {
  //       await this.locationRepo.update(existing.id, item);
  //     }
  //   }
  // }
}
