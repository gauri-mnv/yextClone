import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
import { Location } from '../location.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class MapQuestScraperService {
  constructor(
    @InjectRepository(Location)
    private locationRepo: Repository<Location>,
  ) {}

  async scrapeMapQuest(query: string): Promise<LocationResponseDto[]> {
    console.log(`\n🗺️ [MapQuest] Starting Scrape for: ${query} `);

    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    try {
      // MapQuest Search URL Pattern: /search/results?query=[BusinessName]&location=[Location]
      const searchQuery = encodeURIComponent(query);
      // const searchUrl = `https://www.mapquest.com/search/results?query=${searchQuery}&location=${searchLocation}`;
      const searchUrl = `https://www.mapquest.com/search/${searchQuery}`;

      console.log(`🔗 [MapQuest] Navigating to: ${searchUrl}`);

      await page.goto(searchUrl, {
        // waitUntil: 'networkidle', // Zaruri hai kyunki MapQuest maps aur pins load karta hai
        waitUntil: 'domcontentloaded',
        timeout: 40000,
      });
      await page.waitForTimeout(3000);

      // Results container ke aane ka wait karein
      try {
        // await page.waitForSelector('.result-item, .listing', {
        //   timeout: 20000,
        // });
        await page.waitForTimeout(3000);
      } catch (e) {
        console.log(
          '⚠️ [MapQuest] No immediate results found. Checking page content...',
          e,
        );
      }

      // 1. Extracting Links
      // const links = await page.evaluate(() => {
      //   const anchors = Array.from(
      //     document.querySelectorAll('a.title, a.name, .result-item a,h1 '),
      //   );
      //   return anchors
      //     .map((a) => (a as HTMLAnchorElement).href)
      //     .filter((link) => {
      //       // Sirf un links ko lein jo kisi business profile par ja rahe hon
      //       return (
      //         link.split('/').length > 5 && // Kam se kam Country/Province/City/Name hona chahiye
      //         !link.includes('/search') && // Search results page ko skip karein
      //         !link.includes('/directions') && // Directions ko skip karein
      //         !link.includes('/hotels') && // Faltu categories skip karein
      //         link.includes('mapquest.com/')
      //       );
      //     })
      //     .filter((link, index, self) => self.indexOf(link) === index)
      //     .slice(0, 6);
      // });

      // 1. Extracting Links
      const links = await page.evaluate(() => {
        // MapQuest ke naye structure mein 'a' tags ko target karein jo profile par le jayein
        const anchors = Array.from(
          document.querySelectorAll('a, a[href], a.title'),
        );

        return anchors
          .map((a) => (a as HTMLAnchorElement).href)
          .filter((link) => {
            return (
              link.includes('mapquest.com/') &&
              link.split('/').length > 5 && // Business deep link check
              !link.includes('/search') &&
              !link.includes('/directions')
            );
          })
          .filter((link, index, self) => self.indexOf(link) === index)
          .slice(0, 6);
      });

      console.log(`✅ [MapQuest] Found ${links.length} potential links.`);

      const finalResults: LocationResponseDto[] = [];

      // 2. Deep Dive Loop
      for (const link of links) {
        const newPage = await context.newPage();
        try {
          console.log(`\n--- 🕵️ [MapQuest] Deep Searching: ${link} ---`);
          await newPage.goto(link, {
            waitUntil: 'domcontentloaded',
            timeout: 25000,
          });

          const extractedData = await newPage.evaluate((link) => {
            // 1. Name: MapQuest aksar h1 ya data-testid="listing-name" use karta hai
            const h1 = document.querySelector('h1')?.innerText;
            const iD = document.querySelector(
              '[data-testid="infosheet-header"]',
            )?.innerHTML;

            // data-testid="infosheet-header"
            // const name = h1||iD || '';
            const name = h1 ?? iD ?? '';

            // 2. Address: Aapke screenshot (image_48bb82.jpg) ke hisab se address
            // is specific span mein hai. Hum [data-testid] ya generic classes use karenge.
            const addressEl =
              document.querySelector('[data-testid="details-address-text"]') ||
              document.querySelector('.address-container span') ||
              document.querySelector('.address');

            const address = addressEl?.textContent || '-';
            // 3. Phone: data-testid="bento-call" wale anchor ka href uthayenge
            const phoneEl = document.querySelector(
              '[data-testid="bento-call"]',
            );
            let phone = '-';
            if (phoneEl) {
              const href = phoneEl.getAttribute('href'); // tel:+15877759911
              phone = href ? href.replace('tel:', '') : '-';
            }
            // // 3. Phone: Screenshot mein niche 'tel' link dikh raha hai
            // const phoneEl = document.querySelector('a[href^="tel:"]');
            // const phone = phoneEl
            //   ? phoneEl.getAttribute('href')?.replace('tel:', '')
            //   : '-';

            return {
              name: name.trim(),
              phone: phone ? phone.trim() : '-',
              address: address.trim().replace(/\s+/g, ' '),
              link: link,
            };
          }, link);

          // 🔥 PUSH SE PEHLE CONSOLE LOG (VS Code terminal mein dikhega)
          console.log(`📊 [MapQuest] Extracted Data:`);
          console.log(`   Name:    ${extractedData.name}`);
          console.log(`   Phone:   ${extractedData.phone}`);
          console.log(`   Address: ${extractedData.address}`);
          console.log(`   link: ${extractedData.link}`);

          finalResults.push({
            name: extractedData.name,
            address: extractedData.address,
            phone: extractedData.phone,
            locationLink: link,
            source: 'MapQuest',
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          console.log(`❌ [MapQuest] Error deep searching: ${link}`, e);
        } finally {
          await newPage.close();
        }
      }

      if (finalResults.length > 0) {
        await this.saveResults(finalResults, query);
      }

      return finalResults;
    } catch (error) {
      console.error('❌ [MapQuest] Global Scraper Error:', error);
      return [];
    } finally {
      await browser.close();
      console.log('--- 🏁 MAPQUEST SCRAPER FINISHED ---');
    }
  }

  // Same Robust Save Logic
  async saveResults(results: LocationResponseDto[], targetName: string) {
    const searchKeywords = targetName.toLowerCase().split(' ');
    for (const item of results) {
      if (!item.name || item.name === '-') continue;

      const itemName = item.name.toLowerCase();
      const matchCount = searchKeywords.filter((key) =>
        itemName.includes(key),
      ).length;

      if (matchCount < Math.ceil(searchKeywords.length / 2)) continue;

      const existing = await this.locationRepo.findOne({
        where: { locationLink: item.locationLink },
      });
      if (!existing) {
        await this.locationRepo.save(this.locationRepo.create(item));
        console.log(`💾 [MapQuest] Saved: ${item.name}`);
      }
    }
  }
}
