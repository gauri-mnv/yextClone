/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
import { chromium } from 'playwright-extra';

@Injectable()
export class CylexScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeCylex(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    // const stealth = require('puppeteer-extra-plugin-stealth')();
    // chromium.use(stealth);
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--use-gl=swiftshader',
        '--disable-webgl',
      ],
      proxy: {
        server: 'http://ca-residential-proxy:port',
      },
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
    });
    const page = await context.newPage();

    // Stealth script level 1
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    try {
      const searchQuery = name.replace(/\s+/g, '+');
      // Direct search ke bajaye home page par jayein
      await page.goto(
        `https://www.cylex-canada.ca/s?q=${searchQuery}&c=&z=&p=1&dst=&sUrl=&cUrl=`,
        {
          waitUntil: 'domcontentloaded',
          timeout: 60000,
        },
      );

      await Promise.race([
        page.waitForSelector('.search-results, .h4.bold', { timeout: 45000 }), // Success path
        page.waitForSelector('#challenge-error-text', { timeout: 45000 }), // Failure path
      ]);
      await page.waitForFunction(
        () => {
          return (
            !document.title.includes('Just a moment') &&
            !document.body.innerText.includes('security verification')
          );
        },
        { timeout: 30000 },
      );

      await page.waitForSelector('button.btn-outline-secondary, .h4.bold a', {
        state: 'visible',
        timeout: 30000,
      });
      // 🔥 Step 1: Wait for Cloudflare to clear automatically
      await page
        .waitForFunction(
          () => {
            return (
              !document.body.innerText.includes('Cloudflare') &&
              !document.body.innerText.includes('Checking your browser')
            );
          },
          { timeout: 30000 },
        )
        .catch(() => alert('⚠️ Still on challenge page, trying to proceed...'));
      const searchInputSelector =
        'input#search-what, input[name="q"], .search-form input';
      await page.waitForSelector(searchInputSelector, {
        state: 'visible',
        timeout: 15000,
      });

      await page.fill(searchInputSelector, name);
      await page.keyboard.press('Enter');

      await page.waitForSelector('.search-results, .h4.bold', {
        timeout: 20000,
      });

      // Link Extraction (Jo pehle discuss kiya tha)
      const links = await page.evaluate(() => {
        const results: string[] = [];

        // Extract from Title Link
        const titles = document.querySelectorAll('.h4.bold a');
        titles.forEach((a) => results.push((a as HTMLAnchorElement).href));

        // Extract from 'More Info' button onclick
        const buttons = document.querySelectorAll(
          'button.btn-outline-secondary',
        );
        buttons.forEach((btn) => {
          const onclick = btn.getAttribute('onclick') || '';
          const match = onclick.match(/'([^']+)'/);
          if (match) {
            const url = match[1].startsWith('http')
              ? match[1]
              : `https://www.cylex-canada.ca${match[1]}`;
            results.push(url);
          }
        });

        return [...new Set(results)]
          .filter((l) => l.includes('/company/'))
          .slice(0, 3);
      });

      const finalResults: LocationResponseDto[] = [];

      // 5. Deep Dive with logic from image_f86a08.png
      for (const link of links) {
        const newPage = await context.newPage();
        try {
          await newPage.goto(link, {
            waitUntil: 'domcontentloaded',
            timeout: 30000,
          });

          const extractedData = await newPage.evaluate((currentLink) => {
            const bizName =
              document.querySelector('[itemprop="name"], h1, .h4.bold')
                ?.textContent || '-';
            const address =
              document.querySelector('.addr, [itemprop="address"]')
                ?.textContent || '-';
            const phone =
              document.querySelector(
                '.lm-ph, [itemprop="telephone"], a[href^="tel:"]',
              )?.textContent || '-';

            return {
              name: bizName.trim(),
              phone: phone.trim(),
              address: address.trim().replace(/\s+/g, ' '),
              locationLink: currentLink,
            };
          }, link);

          finalResults.push({
            name: extractedData.name,
            address: extractedData.address,
            phone: extractedData.phone,
            locationLink: link,
            source: 'Cylex',
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          console.error(`❌ [Cylex] Link failed: ${link} ${e}`);
        } finally {
          await newPage.close();
        }
      }
      return finalResults;
    } catch (error) {
      console.error(
        `❌ [Cylex] Scraping failed for ${name} in ${location}: ${error}`,
      );
      return [];
    } finally {
      await browser.close();
    }
  }
}
