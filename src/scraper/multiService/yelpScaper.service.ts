import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { Repository } from 'typeorm';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';

@Injectable()
export class YelpScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeYelp(
    businessName: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    //console.log('--- 🚀 YELP SCRAPER STARTED ---');
    const browser = await chromium.launch({
      headless: true,
      // args: [
      //   '--no-sandbox',
      //   '--disable-setuid-sandbox',
      //   '--disable-dev-shm-usage',
      //   '--disable-accelerated-2d-canvas',
      //   '--no-first-run',
      //   '--no-zygote',
      //   '--single-process', // Resources bachata hai
      //   '--disable-gpu',
      // ],
    });
    // const context = await browser.newContext({});
    // const context = await browser.newContext({
    //   userAgent:
    //     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    //   viewport: { width: 1280, height: 720 },
    //   extraHTTPHeaders: {
    //     'Accept-Language': 'en-US,en;q=0.9',
    //   },
    // });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        // Referer: 'https://www.google.com/',
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
      //console.log(`🔗 Navigating to: ${searchUrl}`);

      // await page.goto(searchUrl, { waitUntil: 'networkidle' });

      await page.goto('https://www.yelp.com', { waitUntil: 'networkidle' });
      await page.goto(searchUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(2000 + Math.random() * 3000);

      const hasCaptcha = await page.isVisible('iframe[title*="reCAPTCHA"]');
      if (hasCaptcha) {
        // console.log(
        //   '🚨 CAPTCHA DETECTED! Please solve it in the browser window.',
        // );
        await page.waitForTimeout(15000);
      }
      await page.screenshot({ path: 'yelp-debug.png' });
      //console.log('📸 Screenshot saved as yelp-debug.png');

      // 1. Pehle saari valid links collect karein
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
      // console.log(
      //   `🔗 Found ${businessLinks.length} unique business links. Fetching details...`,
      // );
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
          console.log(`Failed to fetch details for ${link}`, e);
          // console.error('❌ Yelp Error:', e);
          return [];
        }
      }

      return finalResults;
    } finally {
      await browser.close();
      // console.log('--- 🏁 YELP SCRAPER FINISHED ---');
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
