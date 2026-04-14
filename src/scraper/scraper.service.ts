/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from './dto/location-response.dto';
import { chromium } from 'playwright';
import { Repository } from 'typeorm';
import { Location } from './location.entity';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class ScraperService {
  constructor(
    @InjectRepository(Location)
    private locationRepo: Repository<Location>,
  ) {}

  async scrapeGoogleMaps(query: string): Promise<LocationResponseDto[]> {
    // 1. Launch Browser
    const browser = await chromium.launch({ headless: true });
    // const context = await browser.newContext({
    //   userAgent:
    //     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // });
    // const page = await context.newPage();
    // const page = await browser.newPage();
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      // 2. Correct Google Maps Search URL
      // const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
      console.log(`Searching: ${searchUrl}`);
      // await page.goto(searchUrl, { waitUntil: 'networkidle' });
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 10000,
      });

      // try {
      //   const consentButton = await page.$('button[aria-label="Accept all"]');
      //   if (consentButton) await consentButton.click();
      try {
        const consentButton = page.locator(
          'button:has-text("Accept all"), button:has-text("I agree")',
        );
        if (await consentButton.isVisible({ timeout: 1000 })) {
          await consentButton.click();
        }
      } catch (error) {
        console.log(error);
      }
      try {
        // await page.waitForSelector('a.hfpxzc', { timeout: 10000 });
        // await page.waitForSelector('div[role="article"], .qBF1Pd', {
        //   timeout: 20000,
        // });

        await page.waitForSelector('div[role="article"], h1.DUwDvf', {
          timeout: 15000,
        });
      } catch (error) {
        console.log('No results found or timeout', error);
        await browser.close();
        return [];
      }

      // 4. Extract Data using page.evaluate
      // const scrapedData = await page.evaluate(() => {
      //   const items = Array.from(
      //     document.querySelectorAll('div[role="article"]'),
      //   ); // Result cards
      //   console.log('items', items);
      //   return items.map((item) => {
      //     const name = item.querySelector('.qBF1Pd')?.textContent || 'N/A';

      //     // Address extraction logic
      //     const details = Array.from(item.querySelectorAll('.W4Efsd')).map(
      //       (el) => el.textContent || '',
      //     );
      //     // Biasanya index ke-2 ya ke-1 mein address hota hai
      //     const address = details.find((text) => text.length > 10) || 'N/A';

      //     // Phone extraction (Regex check)
      //     const itemText = item.textContent || '';
      //     const phoneMatch = itemText.match(
      //       /(\+?\d{1,4}[\s-]?)?\(?\d{3,5}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/,
      //     );
      //     const phone = phoneMatch ? phoneMatch[0] : 'N/A';

      //     return { name, address, phone };
      //   });
      // });

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
              ?.textContent?.trim() || 'N/A';
          return [
            {
              name: exactName,
              address: address.replace(/^/, ''),
              phone: phone.replace(/^/, ''),
              locationLink: window.location.href,
            },
          ];
        }

        // 2. Agar List khuli hai (Fallback)
        const items = Array.from(
          document.querySelectorAll('div[role="article"]'),
        );
        return items.map((item) => ({
          name: item.querySelector('.qBF1Pd')?.textContent || 'N/A',
          address:
            Array.from(item.querySelectorAll('.W4Efsd'))
              .map((el) => el.textContent || '')
              .find((d) => d.includes(',') || d.length > 10) || 'N/A',
          // address:
          //   item.querySelector('.W4Efsd:nth-child(2)')?.textContent || 'N/A',
          phone: item.querySelector('.Us7ffb')?.textContent || 'N/A',

          locationLink:
            (item.querySelector('a.hfpxzc') as HTMLAnchorElement)?.href || '',
        }));
        //  return { name, address, phone };
      });

      // 5. Database mein Save karein
      const finalResults: LocationResponseDto[] = [];

      for (const item of scrapedData) {
        // Business logic: Sirf valid results save karein
        if (item.name !== 'N/A') {
          const newLoc = this.locationRepo.create({
            name: item.name, // Make sure entity fields match
            address: item.address,
            phone: item.phone,
            locationLink: item.locationLink || '',
          });

          await this.locationRepo.save(newLoc);

          finalResults.push({
            name: item.name,
            address: item.address,
            phone: item.phone,
            source: 'Google Maps Scraper',
            timestamp: new Date().toISOString(),
            locationLink: item.locationLink?.toString() || '',
          });
        }
      }

      await browser.close();
      console.log(`Successfully scraped ${finalResults.length} items`);
      return finalResults;
    } catch (error) {
      console.error('Scraping Error:', error);
      await browser.close();
      return [];
    }
  }
}
