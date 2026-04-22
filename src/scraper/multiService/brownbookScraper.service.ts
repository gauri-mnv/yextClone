/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/restrict-plus-operands */
import { Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Location } from '../location.entity';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());
@Injectable()
export class BrownbookScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }
  async scrapeBrownbook(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--window-size=1920,1080',
      ],
    });
    const userDataDir = './brownbook_session';
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false,
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = await context.newPage();

    try {
      await page.goto('https://www.brownbook.net/', {
        waitUntil: 'networkidle',
      });
      await page.click('input[placeholder="Business type or name"]');
      const modalInput = '#toolbar-search-input';
      await page.waitForSelector(modalInput, {
        state: 'visible',
        timeout: 5000,
      });
      const cleanName = name.split(',')[0].trim();
      await page.fill(modalInput, ''); // Pehle clear karo
      await page.type(modalInput, cleanName, { delay: 150 });

      const cityName =
        location.split(',')[1]?.trim() || location.split(',')[0].trim();
      const locationInput = 'input[placeholder="Location"], #city_select';
      await page.type(locationInput, cityName, { delay: 100 });
      const dropdownButton =
        'button[aria-haspopup="dialog"], button:has(span:text("Canada"))';
      const selectedText = await page.innerText(dropdownButton);
      if (!selectedText.includes('Canada')) {
        await page.click(dropdownButton);
        const canadaOption =
          '[role="option"]:has-text("Canada"), div:text-is("Canada")';
        await page.waitForSelector(canadaOption, { state: 'visible' });
        await page.click(canadaOption);
      }

      await page.click(
        'button:text-is("Search"), .bg-primary.text-white.rounded-md',
      );

      await page.waitForTimeout(3000);
      const resultOrCaptcha = await Promise.race([
        page
          .waitForSelector('.search-results, .business-title', {
            timeout: 20000,
          })
          .then(() => 'RESULTS'),
        page
          .waitForSelector('iframe[title*="reCAPTCHA"]', { timeout: 20000 })
          .then(() => 'CAPTCHA'),
        page
          .waitForSelector('.no-results, :has-text("Results Found 0")', {
            timeout: 20000,
          })
          .then(() => 'ZERO_RESULTS'),
      ]).catch(() => 'TIMEOUT');

      if (resultOrCaptcha === 'CAPTCHA') {
        try {
          const captchaFrame = await page.waitForSelector(
            'iframe[title*="reCAPTCHA"]',
            { state: 'visible', timeout: 10000 },
          );
          const frame = await captchaFrame.contentFrame();

          if (frame) {
            const checkbox = await frame.waitForSelector('#recaptcha-anchor', {
              state: 'visible',
              timeout: 5000,
            });

            await page.mouse.move(Math.random() * 500, Math.random() * 500);
            await page.waitForTimeout(1500);

            await checkbox.click();

            await page.waitForTimeout(5000);
          }
        } catch (e) {
          console.error(
            `❌ [Brownbook] Failed to interact with captcha iframe: ${e}`,
          );
        }
      }

      if (resultOrCaptcha === 'RESULTS') {
        // 1. Pehle search results page se business link uthao
        const businessLink = await page.evaluate((targetName) => {
          const links = Array.from(
            document.querySelectorAll('a[href*="/business/"]'),
          );
          // Name matching logic taaki sahi business mile
          const match = links.find((a) =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            a.textContent?.toLowerCase().includes(targetName.toLowerCase()),
          );
          return match ? (match as HTMLAnchorElement).href : null;
        }, cleanName);

        if (businessLink) {
          // 2. Detail page par navigate karo full NAP data ke liye
          await page.goto(businessLink, { waitUntil: 'domcontentloaded' });

          const finalData = await page.evaluate((url) => {
            const getText = (sel: string) =>
              document.querySelector(sel)?.textContent?.trim() || '-';

            return {
              name: getText('h1'),
              address: getText('.address, #address, [itemprop="address"]'),
              phone: getText('.phone, #phone_number, [itemprop="telephone"]'),
              website:
                (
                  document.querySelector(
                    'a[href^="http"]:not([href*="brownbook"])',
                  ) as HTMLAnchorElement
                )?.href || '-',
              locationLink: url,
              source: 'Brownbook',
              timestamp: new Date().toISOString(),
            };
          }, businessLink);

          console.log(`✅ [Brownbook] Extracted: ${finalData.name}`);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return [finalData];
        } else {
          console.warn(
            '⚠️ [Brownbook] Business name match nahi hua results mein.',
          );
        }
      }

      return [];
    } catch (e) {
      console.error(`❌ [Brownbook] Error: ${e}`);
      return [];
    } finally {
      await browser.close();
    }
  }
}
