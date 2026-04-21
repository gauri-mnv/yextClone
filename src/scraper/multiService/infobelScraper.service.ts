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
        // Canada addresses mein City aksar second last ya second position pe hoti hai
        // Hum Province/Postal Code wale part ko skip karke City uthayenge
        city = parts[1];
      }

      // Cleanup: Agar city me still "Market St" jaisa kuch hai, toh regex use karein
      console.log(`🔍 [Infobel] Searching for "Dental Clinics" in ${city}...`);

      await page.goto('https://www.infobel.com/en/canada', {
        waitUntil: 'domcontentloaded',
        // timeout: 60000,
      });
      console.log(`⌨️ Filling: Dental Clinics in ${city}`);
      await page.waitForSelector('#search-term-input-header', {
        timeout: 10000,
      });
      await page.fill('#search-term-input-header', 'Dental Clinics');

      // "Where" field
      await page.fill('#search-location-input-header', city);

      // 3. Click Search [image_a16d23.jpg: btn-search-header]
      await page.click('#btn-search-header');

      // 4. Wait for Results List
      await page.waitForSelector('.customer-box', { timeout: 45000 });

      // 3. List me se EXACT Business Name find karein
      console.log(`🎯 Looking for exact match: ${targetName}`);
      page.on('console', (msg) => {
        // Aap isme prefix bhi laga sakte ho taaki pehchan sako ki ye browser ka log hai
        console.log(`🌐 [BROWSER]: ${msg.text()}`);
      });
      const businessUrl = await page.evaluate((name) => {
        const items = Array.from(document.querySelectorAll('.customer-box'));
        const target = name.toLowerCase().replace(/[^a-z0-9]/g, '');
        console.log(`--- Starting Matching for: ${target} ---`);
        // Name check logic
        const match = items.find((item) => {
          const foundName =
            item.querySelector('.customerName h2 a')?.textContent?.trim() || '';
          const cleanFoundName = foundName
            .toLowerCase()
            .replace(/^\d+\.\s*/, '') // Shuruat ka "6. " hatao
            .replace(/[^a-z0-9]/g, ''); // Sab alphanumeric clean karo
          console.log(
            `Checking Item: "${foundName}" | Cleaned: "${cleanFoundName}"`,
          );
          return (
            cleanFoundName.includes(target) || target.includes(cleanFoundName)
          );
        });
        console.log(`--- Matching Completed ---`, match);
        return match
          ? (match.querySelector('a.customerName h2 a') as HTMLAnchorElement)
              ?.href
          : null;
      }, targetName);

      if (!businessUrl) {
        console.log('❌ [Infobel] Exact business name list not found .');
        return [];
      }

      // 4. More Info (Detail Page) par jayein
      console.log('📄 [Infobel] Opening detail page...');
      await page.goto(businessUrl, { waitUntil: 'networkidle' });

      // 5. Detail Page se saara data extract karein
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

      console.log(`✅ [Infobel] Success: Extracted data for ${finalData.name}`);
      return [finalData];
    } catch (e) {
      console.error('❌ [Infobel] Error:', e);
      return [];
    } finally {
      await browser.close();
    }
  }
}
