/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Location } from '../location.entity';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

@Injectable()
export class IGlobalScraperService {
  constructor(
    @InjectRepository(Location)
    private locationRepo: Repository<Location>,
  ) {}

  async scrapeIGlobal(targetName: string): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      const searchUrl = `https://www.iglobal.co/canada/search/${encodeURIComponent(targetName)}`;

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      const businessUrl = await page.evaluate(
        ({ name }) => {
          const items = Array.from(document.querySelectorAll('a'));
          const targetClean = name.toLowerCase().replace(/[^a-z0-9]/g, '');

          const match = items.find((a) => {
            const foundName = a.textContent?.trim() || '';
            const cleanFound = foundName
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '');
            return (
              cleanFound.includes(targetClean) && a.href.includes('/canada/')
            );
          });

          return match ? match.href : null;
        },
        { name: targetName },
      );

      if (!businessUrl) {
        return [];
      }
      await page.goto(businessUrl, {
        waitUntil: 'networkidle',
        timeout: 30000,
      });
      const finalData = await page.evaluate((sourceUrl) => {
        const name =
          document
            .querySelector('h1.company-profile-name')
            ?.textContent?.trim() || '-';
        const addressEl = document.querySelector('a.card-location span');
        const address = addressEl?.textContent?.trim() || '-';

        const phone =
          document.querySelector('a[href^="tel:"]')?.textContent?.trim() || '-';

        const website =
          (
            document.querySelector(
              'a[href^="http"]:not([href*="iglobal"])',
            ) as HTMLAnchorElement
          )?.href || '-';

        return {
          name,
          address: address.replace(/\s+/g, ' ').trim(),
          phone,
          website,
          locationLink: sourceUrl,
          source: 'iGlobal',
        };
      }, businessUrl);

      return [
        {
          ...finalData,
          timestamp: new Date().toISOString(),
        },
      ];
    } catch (e) {
      alert(`❌ [iGlobal] Error: ${e}`);
      return [];
    } finally {
      await browser.close();
    }
  }
}
