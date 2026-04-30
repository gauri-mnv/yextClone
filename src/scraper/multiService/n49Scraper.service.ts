/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';

@Injectable()
export class N49ScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeN49(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    try {
      const cityOrZip =
        location.split(',')[1]?.trim() || location.split(' ').pop() || location;
      const searchQuery = encodeURIComponent(name);
      const searchLocation = encodeURIComponent(cityOrZip);
      const searchUrl = `https://www.n49.com/search/${searchQuery}/42041/${searchLocation}/`;

      await page.goto(searchUrl, {
        waitUntil: 'networkidle',
        timeout: 45000,
      });
      try {
        await page.waitForSelector(
          '.suggestion-search, .search-suggestions, a[href*="/biz/"]',
          { timeout: 20000 },
        );
      } catch (e) {
        console.log(
          `⚠️ [N49] Suggestions/Results took too long or not found.,\n${e}`,
        );
      }
      const links = await page.evaluate(() => {
        const foundLinks: string[] = [];
        const allAnchors = Array.from(
          document.querySelectorAll('a[href*="/biz/"]'),
        );
        allAnchors.forEach((a) => {
          const href = (a as HTMLAnchorElement).href;
          if (href) foundLinks.push(href);
        });
        return [...new Set(foundLinks)].slice(0, 5);
      });

      const finalResults: LocationResponseDto[] = [];
      for (const link of links) {
        const newPage = await context.newPage();
        try {
          await newPage.goto(link, {
            waitUntil: 'load',
            timeout: 20000,
          });
          await page.waitForTimeout(1000);

          const extractedData = await newPage.evaluate(() => {
            const bizName =
              document.querySelector('h1, .biz-name')?.textContent || '-';

            const phoneEl = document.querySelector(
              '.biz-phone, [href^="tel:"]',
            );
            const phone = phoneEl?.textContent || '-';

            // Address extraction
            const addressEl = document.querySelector('.biz-address, .address');
            const address = addressEl?.textContent || 'N49 Listing';

            return {
              name: bizName.trim(),
              phone: phone.trim().replace(/\s+/g, ' '),
              address: address.trim().replace(/\s+/g, ' '),
            };
          });

          finalResults.push({
            name: extractedData.name !== '' ? extractedData.name : '—',
            address: extractedData.address,
            phone: extractedData.phone !== '' ? extractedData.phone : '—',
            locationLink: newPage.url() || '—',
            source: 'N49',
            timestamp: new Date().toISOString(),
          });
          return finalResults;
        } catch (e) {
          alert(`❌ [N49] Error scraping deep link: ${link}\n${e}`);
        } finally {
          await newPage.close();
        }
      }

      // 3. Save to Database
      // if (finalResults.length > 0) {
      //   await this.saveResults(finalResults, name);
      // }

      return finalResults;
    } catch (error) {
      console.log(`❌ [N49] Global Scraper Error: ${error}`);
      return [];
    } finally {
      await browser.close();
    }
  }

  // async saveResults(results: LocationResponseDto[], targetName: string) {
  //   const searchKeywords = targetName.toLowerCase().split(' ');
  //   for (const item of results) {
  //     if (!item.name || item.name === '-') continue;

  //     const itemName = item.name.toLowerCase();
  //     const matchCount = searchKeywords.filter((key) =>
  //       itemName.includes(key),
  //     ).length;

  //     // 50% Match Logic
  //     if (matchCount < Math.ceil(searchKeywords.length / 2)) {
  //       console.log(`🚫 [N49] Filtering out unrelated: ${item.name}`);
  //       continue;
  //     }

  //     const existing = await this.locationRepo.findOne({
  //       where: { locationLink: item.locationLink },
  //     });
  //     if (!existing) {
  //       await this.locationRepo.save(this.locationRepo.create(item));
  //       //console.log(`💾 [N49] Saved: ${item.name}`);
  //     }
  //   }
  // }
}
