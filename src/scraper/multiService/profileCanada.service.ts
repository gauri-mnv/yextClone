import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Location } from '../location.entity';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright-extra';

@Injectable()
export class ProfileCanadaScraperService {
  constructor(
    @InjectRepository(Location)
    private locationRepo: Repository<Location>,
  ) {}

  async scrapeProfileCanada(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    // console.log(
    //   `\n🚀 [ProfileCanada] Starting Scrape for: ${name} in ${location}`,
    // );
    const parts = location.split(',');
    const cityName =
      parts.length > 1
        ? parts[parts.length - 2].trim().replace(/\s+/g, '+')
        : '';

    if (!cityName) {
      // console.log('❌ City name extract nahi ho paya.');
      return [];
    }

    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    try {
      const searchUrl = `https://www.profilecanada.com/category.cfm?cat=8021_Dentists&provP=AB&city=${cityName}`;
      // console.log(`🔗 [ProfileCanada] Navigating to: ${searchUrl}`);

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });

      // 3. Page par Business Name search karna aur link find karna
      const targetLink = await page.evaluate((targetName) => {
        const lowerName = targetName.toLowerCase();
        const allLinks = Array.from(
          document.querySelectorAll('a[href*="companydetail.cfm"]'),
        );

        const foundLink = allLinks.find(
          (a) =>
            a.textContent?.toLowerCase().includes(lowerName) ||
            a.parentElement?.textContent?.toLowerCase().includes(lowerName),
        );

        return foundLink ? (foundLink as HTMLAnchorElement).href : null;
      }, name);

      if (!targetLink) {
        // console.log(
        //   `⚠️ [ProfileCanada] Name "${name}" result page par nahi mila.`,
        // );
        return [];
      }

      // console.log(`🎯 [ProfileCanada] Business Link Found: ${targetLink}`);
      await page.goto(targetLink, { waitUntil: 'domcontentloaded' });

      const extractedData = await page.evaluate((link) => {
        const getName = () =>
          document
            .querySelector('h1, [itemprop="name"]')
            ?.textContent?.trim() || '-';
        const getAddress = () => {
          const addr = document
            .querySelector('.address, #company_address, [itemprop="address"]')
            ?.textContent?.trim();
          return addr ? addr.replace(/\s+/g, ' ') : '-';
        };
        const getPhone = () =>
          document
            .querySelector('.phone, .tel, [itemprop="telephone"]')
            ?.textContent?.trim() || '-';
        const getWebsite = () => {
          const webBtn = document.querySelector(
            'a[href*="http"]:not([href*="profilecanada"])',
          );
          return webBtn ? (webBtn as HTMLAnchorElement).href : '-';
        };

        return {
          name: getName(),
          address: getAddress(),
          phone: getPhone(),
          website: getWebsite(),
          locationLink: link,
        };
      }, targetLink);

      const finalResult: LocationResponseDto = {
        ...extractedData,
        source: 'ProfileCanada',
        timestamp: new Date().toISOString(),
      };

      // console.log(`✅ [ProfileCanada] Extracted: ${finalResult.name}`);
      return [finalResult];
    } catch (error) {
      console.error('❌ [ProfileCanada] Scraper Error:', error);
      return [];
    } finally {
      await browser.close();
    }
  }
}
