import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import { LocationResponseDto } from '../dto/location-response.dto';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Location } from '../location.entity';

@Injectable()
export class FacebookScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeFacebook(name: string): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      viewport: { width: 1280, height: 800 },
    });

    const page = await context.newPage();

    try {
      //STEP 1: GENERATE SLUGS
      const base = name.toLowerCase().replace(/[^a-z0-9]/g, '');

      const variations = [
        base,
        base.replace('clinic', ''),
        base.replace('dental', ''),
        base.replace('clinic', '').replace('dental', ''),
        name.toLowerCase().replace(/\s+/g, ''),
      ];

      let targetLink: string | null = null;

      //STEP 2: TRY DIRECT URL
      for (const slug of variations) {
        const url = `https://www.facebook.com/${slug}/`;

        console.log('[FB] Trying slug:', url);

        try {
          const res = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
          });

          if (res && res.status() === 200) {
            const title = await page.title();

            if (!title.toLowerCase().includes('not found')) {
              targetLink = url;
              console.log('[FB] Found via slug:', url);
              break;
            }
          }
        } catch {
          continue;
        }
      }

      //STEP 3: FALLBACK SEARCH
      if (!targetLink) {
        const searchUrl = `https://www.facebook.com/search/pages?q=${encodeURIComponent(
          name,
        )}`;

        console.log('[FB] Fallback search:', searchUrl);

        await page.goto(searchUrl, {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        });

        await page.waitForTimeout(5000);

        const links = await page.locator('a[href*="facebook.com"]').all();

        for (const link of links.slice(0, 5)) {
          const text = (await link.textContent())?.toLowerCase() || '';

          if (text.includes(name.toLowerCase())) {
            const href = await link.getAttribute('href');

            if (href && !href.includes('search')) {
              targetLink = href;
              console.log('[FB] Found via search:', targetLink);
              break;
            }
          }
        }
      }

      if (!targetLink) {
        console.log('[FB] No page found');
        return [];
      }

      //STEP 4: OPEN DETAIL PAGE
      const detailPage = await context.newPage();

      await detailPage.goto(targetLink, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      await detailPage.waitForTimeout(5000);

      //STEP 5: EXTRACT DATA
      const data = await detailPage.evaluate(() => {
        const clean = (txt: any) =>
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          txt ? txt.replace(/\s+/g, ' ').trim() : '-';

        const name =
          document.querySelector('h1')?.textContent || document.title;

        const bodyText = document.body.innerText;

        // PHONE
        const phoneMatch = bodyText.match(
          /(\+?\d{1,2}[\s-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
        );

        const phone = phoneMatch ? phoneMatch[0] : '-';

        // ADDRESS
        let address = '-';

        const lines = bodyText.split('\n');

        for (const line of lines) {
          if (
            line.includes('Street') ||
            line.includes('St') ||
            line.includes('Road') ||
            line.includes('Ave') ||
            line.includes('Canada') ||
            line.includes('USA')
          ) {
            address = clean(line);
            break;
          }
        }

        return {
          name: clean(name),
          phone: clean(phone),
          address,
          locationLink: window.location.href,
        };
      });

      //STEP 6: VALIDATE RESULT
      const keywords = name.toLowerCase().split(' ');
      const itemName = data.name.toLowerCase();

      const matchCount = keywords.filter((k) => itemName.includes(k)).length;

      if (matchCount < Math.ceil(keywords.length / 2)) {
        console.log('[FB] Filtered wrong page:', data.name);
        return [];
      }

      //STEP 7: FORMAT RESULT
      const result: LocationResponseDto = {
        name: data.name,
        phone: data.phone,
        address: data.address,
        locationLink: data.locationLink,
        source: 'Facebook',
        timestamp: new Date().toISOString(),
      };

      // SAVE TO DB
      // await this.saveResults([result]);

      return [result];
    } catch (err) {
      console.error('[FB ERROR]', err);
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
