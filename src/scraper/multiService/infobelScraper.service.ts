import { Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Location } from '../location.entity';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

@Injectable()
export class InfobelScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeInfobel(
    targetName: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
      ],
    });
    const userAgents = [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    ];
    const context = await browser.newContext({
      userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
    });
    const page = await context.newPage();

    try {
      const parts = location.split(',').map((p) => p.trim());
      const city = parts.length >= 2 ? parts[1] : parts[0];
      let attempts = 0;
      const maxRetries = 3;
      let searchSuccessful = false;

      while (attempts < maxRetries && !searchSuccessful) {
        console.log(
          `🔍 [Infobel] Attempt ${attempts + 1}: Searching for ${targetName} in ${city}`,
        );

        await page.goto('https://search.infobelpro.com/', {
          waitUntil: 'networkidle',
        });
        await new Promise((r) => setTimeout(r, Math.random() * 2000 + 1000));
        await page.waitForSelector('#inputName', {
          timeout: 30000,
        });
        await page.click('#inputName');
        await page.type('#inputName', targetName, { delay: 150 });

        await page.mouse.move(Math.random() * 400, Math.random() * 400);

        // await page.click('#searchBtn');
        await page.waitForFunction(
          () => {
            const btn = document.querySelector(
              '#searchBtn',
            ) as HTMLButtonElement;
            return btn && !btn.disabled;
          },
          { timeout: 15000 },
        );

        await page.click('#searchBtn', { force: true });

        await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {
          console.log('Navigation timeout - checking current state...');
        });

        if (page.url().includes('/Abuse')) {
          // console.warn('⚠️ [Infobel] Detected! Abuse page hit. Retrying...');
          await context.clearCookies();

          // Optional: Wait a bit before retrying to look more human
          await new Promise((resolve) => setTimeout(resolve, 5000));
          attempts++;
          continue;
        }

        searchSuccessful = true;
      }

      if (!searchSuccessful) {
        // console.error(
        //   '❌ [Infobel] Failed after max retries due to bot detection.',
        // );
        return [];
      }

      await page
        .waitForSelector('.orderanalysis-table__row', { timeout: 15000 })
        .catch(() => {
          console.log('No results found or page failed to load.');
        });

      // 3. List me se EXACT Business Name find karein
      // page.on('console', (msg) => {
      //   // Aap isme prefix bhi laga sakte ho taaki pehchan sako ki ye browser ka log hai
      //   console.log(`🌐 [BROWSER]: ${msg.text()}`);
      // });
      const businessUrl = await page.evaluate((name) => {
        const items = Array.from(
          document.querySelectorAll('.orderanalysis-table__row'),
        );
        const target = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        // Name check logic
        const match = items.find((item) => {
          const foundName =
            item.querySelector('td a')?.textContent?.trim() || '';
          const cleanFoundName = foundName
            .toLowerCase()
            .replace(/^\d+\.\s*/, '') // Shuruat ka "6. " hatao
            .replace(/[^a-z0-9]/g, ''); // Sab alphanumeric clean karo

          return (
            cleanFoundName.includes(target) || target.includes(cleanFoundName)
          );
        });
        if (match) {
          // Extract the href from the link
          const link = match.querySelector('td a') as HTMLAnchorElement;
          return link ? link.href : null;
        }

        return null;
      }, targetName);

      if (!businessUrl) {
        return [];
      }

      // 4. More Info (Detail Page) par jayein
      await page.goto(businessUrl, { waitUntil: 'networkidle' });
      const finalData = await page.evaluate((sourceUrl) => {
        const name = document.querySelector('h1')?.textContent?.trim() || '—';

        // 2. Address: Look for a container that likely has 'address' in its class or ID
        // Or look for text that contains common address patterns (numbers + street)
        const address =
          document
            .querySelector(
              '.address-text, .location-info, [itemprop="address"]',
            )
            ?.textContent?.trim() || '—';

        // 3. Phone: Look specifically for the tel link
        const phoneLink = document.querySelector('a[href^="tel:"]');
        const phone = phoneLink
          ? phoneLink.textContent?.replace('Tel.', '').trim()
          : '—';

        // 4. Website: Find the external link
        const website =
          (
            document.querySelector(
              'a[href^="http"]:not([href*="infobel"])',
            ) as HTMLAnchorElement
          )?.href || '—';

        return {
          name,
          address,
          phone,
          website,
          locationLink: sourceUrl,
          source: 'Infobel',
          timestamp: new Date().toISOString(),
        };
      }, businessUrl);

      return [finalData];
    } catch (e) {
      // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
      console.error(`❌ [Infobel] Error: ${e}`);
      return [];
    } finally {
      await browser.close();
    }
  }
}
