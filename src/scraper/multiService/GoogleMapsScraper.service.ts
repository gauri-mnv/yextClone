/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { Repository } from 'typeorm';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class GoogleMapsScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }
  //google scraper
  async scrapeGoogleMaps(query: string): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20000,
      });

      try {
        const consentButton = page.locator(
          'button:has-text("Accept all"), button:has-text("I agree")',
        );
        if (await consentButton.isVisible({ timeout: 1000 })) {
          await consentButton.click();
        }
      } catch (error) {
        alert(error);
      }
      try {
        await page.waitForSelector('div[role="article"], h1.DUwDvf', {
          timeout: 15000,
        });
      } catch (error) {
        alert(`No results found or timeout: ${error}`);
        await browser.close();
        return [];
      }

      const scrapedData = await page.evaluate(() => {
        // 1. Check karein agar direct Place Card khula hai (Exact match)
        const exactName = document.querySelector('h1.DUwDvf')?.textContent;
        if (exactName) {
          // Agar direct page khula hai, toh yahan se NAP uthayein
          const address =
            document
              .querySelector('button[data-item-id="address"]')
              ?.textContent?.trim() || 'N/A';
          const phone =
            document
              .querySelector('button[data-tooltip*="phone"]')
              ?.textContent?.trim() || 'In address';
          return [
            {
              name: exactName,
              address: address.replace(/^/, ''),
              phone: phone.replace(/^/, ''),
              locationLink: window.location.href,
            },
          ];
        }

        const items = Array.from(
          document.querySelectorAll('div[role="article"]'),
        );
        return items.map((item) => ({
          name: item.querySelector('.qBF1Pd')?.textContent || 'N/A',
          address:
            Array.from(item.querySelectorAll('.W4Efsd'))
              .map((el) => el.textContent || '')
              .find((d) => d.includes(',') || d.length > 10) || 'N/A',
          phone: item.querySelector('.Us7ffb')?.textContent || 'N/A',

          locationLink:
            (item.querySelector('a.hfpxzc') as HTMLAnchorElement)?.href || '',
        }));
      });
      const finalResults: LocationResponseDto[] = [];

      for (const item of scrapedData) {
        if (item.name !== 'N/A') {
          // const newLoc = this.locationRepo.create({
          //   name: item.name,
          //   address: item.address,
          //   phone: item.phone,
          //   locationLink: item.locationLink || '',
          // });

          // await this.locationRepo.save(newLoc);
          finalResults.push({
            name: item.name,
            address: item.address,
            phone: item.phone,
            source: 'Google Maps',
            timestamp: new Date().toISOString(),
            locationLink: item.locationLink?.toString() || '',
          });
        }
      }
      await browser.close();
      return finalResults;
    } catch (error) {
      alert(`❌ Scraping Error: ${error}`);
      await browser.close();
      return [];
    } finally {
      await browser.close();
    }
  }

  // async saveResults(results: LocationResponseDto[]) {
  //   for (const item of results) {
  //     // 1. Check karein kya ye link pehle se DB mein hai?
  //     const existing = await this.locationRepo.findOne({
  //       where: { locationLink: item.locationLink },
  //     });

  //     if (!existing) {
  //       // 2. Agar nahi hai, tabhi save karein
  //       const newLocation = this.locationRepo.create(item);
  //       await this.locationRepo.save(newLocation);
  //     } else {
  //       // 3. (Optional) Agar hai, toh sirf data update kar sakte hain
  //       await this.locationRepo.update(existing.id, item);
  //     }
  //   }
  // }
}
