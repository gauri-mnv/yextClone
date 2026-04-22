/* eslint-disable @typescript-eslint/no-unsafe-return */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright';
import { LocationResponseDto } from '../dto/location-response.dto';

@Injectable()
export class FacebookScraperService {
  private readonly logger = new Logger(FacebookScraperService.name);

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
      //STEP 1: BUILD SLUGS (1 → 2 → 3 words)
      const words = name.toLowerCase().split(' ').filter(Boolean);

      const slugVariations: string[] = [];

      for (let i = 1; i <= words.length; i++) {
        slugVariations.push(words.slice(0, i).join(''));
      }

      // ["airdrie", "airdriechoice", "airdriechoicedental"]
      let targetLink: string | null = null;

      // STEP 2: TRY SLUGS
      for (const slug of slugVariations) {
        const url = `https://www.facebook.com/${slug}/`;

        this.logger.log(`Trying slug: ${url}`);

        try {
          await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 15000,
          });

          await page.waitForTimeout(3000);

          //STRONG VALIDATION
          const validation = await page.evaluate(() => {
            const text = document.body.innerText.toLowerCase();

            if (
              text.includes("this content isn't available") ||
              text.includes("page isn't available") ||
              text.includes('log in to facebook') ||
              text.includes('you must log in')
            ) {
              return { valid: false };
            }

            const heading = document.querySelector('h1')?.textContent || '';

            return {
              valid: !!heading,
              heading,
            };
          });

          if (!validation.valid) {
            this.logger.warn(`Invalid page: ${url}`);
            continue;
          }

          //NAME MATCH CHECK
          const pageName = (validation.heading ?? '').toLowerCase();

          const matchCount = words.filter((w) => pageName.includes(w)).length;

          if (matchCount < Math.ceil(words.length / 2)) {
            this.logger.warn(`Name mismatch: ${pageName}`);
            continue;
          }

          targetLink = url;
          this.logger.log(`✅ Valid page found: ${url}`);
          break;
        } catch (err) {
          this.logger.warn(`Slug failed: ${url}`);
          continue;
        }
      }

      //STEP 3: GOOGLE FALLBACK
      if (!targetLink) {
        const googleUrl = `https://www.google.com/search?q=${encodeURIComponent(
          name + ' facebook',
        )}`;

        this.logger.log(`Google fallback: ${googleUrl}`);

        await page.goto(googleUrl, {
          waitUntil: 'domcontentloaded',
        });

        await page.waitForTimeout(3000);

        const links = await page.locator('a').all();

        for (const link of links) {
          const href = await link.getAttribute('href');

          if (href && href.includes('facebook.com')) {
            const cleanLink = href.split('&')[0].replace('/url?q=', '');

            if (!cleanLink.includes('search')) {
              targetLink = cleanLink;
              this.logger.log(`✅ Found via Google: ${targetLink}`);
              break;
            }
          }
        }
      }

      if (!targetLink) {
        this.logger.error('No Facebook page found');
        return [];
      }

      //STEP 4: OPEN PAGE
      const detailPage = await context.newPage();

      await detailPage.goto(targetLink, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      await detailPage.waitForTimeout(5000);

      //STEP 5: EXTRACT DATA
      const data = await detailPage.evaluate(() => {
        const clean = (txt: any) =>
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

      //STEP 6: FINAL VALIDATION
      const itemName = data.name.toLowerCase();

      const matchCount = words.filter((w) => itemName.includes(w)).length;

      if (matchCount < Math.ceil(words.length / 2)) {
        this.logger.warn(`Final validation failed: ${data.name}`);
        return [];
      }

      //STEP 7: RESULT
      const result: LocationResponseDto = {
        name: data.name,
        phone: data.phone,
        address: data.address,
        locationLink: data.locationLink,
        source: 'Facebook',
        timestamp: new Date().toISOString(),
      };

      this.logger.log(`SUCCESS: ${data.name}`);

      return [result];
    } catch (err) {
      this.logger.error('Scraper error', err);
      return [];
    } finally {
      await browser.close();
    }
  }
}
