import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Location } from '../location.entity';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

@Injectable()
export class InfobelScraperService {
  constructor(
    @InjectRepository(Location)
    private locationRepo: Repository<Location>,
  ) {}

  async scrapeInfobel(
    targetName: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      const parts = location.split(',').map((p) => p.trim());

      let city = parts[0]; // Default fallback

      if (parts.length >= 2) {
        city = parts[1];
      }
      await page.goto('https://www.infobel.com/en/canada', {
        waitUntil: 'domcontentloaded',
      });

      await page.waitForSelector('#search-term-input-header', {
        timeout: 10000,
      });
      await page.fill('#search-term-input-header', 'Dental Clinics');
      await page.fill('#search-location-input-header', city);

      await page.click('#btn-search-header');

      await page.waitForSelector('.customer-box', { timeout: 45000 });

      // page.on('console', (msg) => {
      //   console.log(`🌐 [BROWSER]: ${msg.text()}`);
      // });
      const businessUrl = await page.evaluate((name) => {
        const items = Array.from(document.querySelectorAll('.customer-box'));
        const target = name.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Name check logic
        const match = items.find((item) => {
          const foundName =
            item.querySelector('.customerName h2 a')?.textContent?.trim() || '';
          const cleanFoundName = foundName
            .toLowerCase()
            .replace(/^\d+\.\s*/, '') // Shuruat ka "6. " hatao
            .replace(/[^a-z0-9]/g, ''); // Sab alphanumeric clean karo

          return (
            cleanFoundName.includes(target) || target.includes(cleanFoundName)
          );
        });

        return match
          ? (match.querySelector('a.customerName h2 a') as HTMLAnchorElement)
              ?.href
          : null;
      }, targetName);

      if (!businessUrl) {
        return [];
      }

      await page.goto(businessUrl, { waitUntil: 'networkidle' });
      const finalData = await page.evaluate((sourceUrl) => {
        return {
          name: document.querySelector('h1')?.textContent?.trim() || '-',
          address:
            document.querySelector('.address')?.textContent?.trim() || '-',
          phone: document.querySelector('.phone')?.textContent?.trim() || '-',
          website:
            (
              document.querySelector(
                'a[href^="http"]:not([href*="infobel"])',
              ) as HTMLAnchorElement
            )?.href || '-',
          locationLink: sourceUrl,
          source: 'Infobel',
          timestamp: new Date().toISOString(),
        };
      }, businessUrl);

      return [finalData];
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      alert(`❌ [Infobel] Error: ${e}`);
      return [];
    } finally {
      await browser.close();
    }
  }
}
