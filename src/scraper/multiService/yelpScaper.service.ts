/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
import { Repository } from 'typeorm';
import { Location } from '../location.entity';
import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class YelpScraperService {
  constructor(
    @InjectRepository(Location)
    private locationRepo: Repository<Location>,
  ) {}

  async scrapeYelp(
    businessName: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
      deviceScaleFactor: 1,
      hasTouch: false,
    });
    const page = await context.newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    try {
      const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(businessName)}&find_loc=${encodeURIComponent(location)}`;

      await page.goto('https://www.yelp.com', { waitUntil: 'networkidle' });
      await page.goto(searchUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000 + Math.random() * 3000);

      const hasCaptcha = await page.isVisible('iframe[title*="reCAPTCHA"]');
      if (hasCaptcha) {
        await page.waitForTimeout(15000);
      }
      await page.screenshot({ path: 'yelp-debug.png' });
      const businessLinks = await page.evaluate(() => {
        const cards = Array.from(
          document.querySelectorAll('div[data-testid="serp-ia-card"]'),
        );
        const links: string[] = [];

        cards.forEach((card) => {
          const linkEl = card.querySelector('h3 a') as HTMLAnchorElement;
          if (
            linkEl &&
            linkEl.href.includes('/biz/') &&
            !linkEl.href.includes('adredir')
          ) {
            links.push(linkEl.href);
          }
        });
        return [...new Set(links)];
      });

      const finalResults: LocationResponseDto[] = [];

      for (const link of businessLinks.slice(0, 5)) {
        try {
          await page.goto(link, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });

          const details = await page.evaluate(() => {
            const name = document.querySelector('h1')?.textContent || 'N/A';

            // Yelp detail page par address aksar 'address' tag ya specific class mein hota hai
            const addressEl = document.querySelector('address');
            const address = addressEl?.textContent?.trim() || 'N/A';

            // Phone dhundne ke liye text scan
            const phoneEl = Array.from(document.querySelectorAll('p')).find(
              (p) =>
                /\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/.test(
                  p.innerText,
                ),
            );
            const phone = phoneEl ? phoneEl.innerText.trim() : 'N/A';

            return { name, address, phone };
          });
          finalResults.push({
            ...details,
            source: 'Yelp',
            locationLink: link,
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          alert(`Failed to fetch details for ${link}: ${e}`);

          return [];
        }
      }

      return finalResults;
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
  //       const newLocation = this.locationRepo.create(item);
  //       await this.locationRepo.save(newLocation);
  //     } else {
  //       // console.log(`⏭️ Skipping duplicate: ${item.name}`);
  //       await this.locationRepo.update(existing.id, item);
  //     }
  //   }
  // }
}
