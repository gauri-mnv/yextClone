import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';

@Injectable()
export class N49ScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeN49(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    try {
      const cityOrZip =
        location.split(',')[1]?.trim() || location.split(' ').pop() || location;
      // N49 Search URL Structure
      const searchQuery = encodeURIComponent(name);
      const searchLocation = encodeURIComponent(cityOrZip);
      const searchUrl = `https://www.n49.com/search/${searchQuery}/42041/${searchLocation}/`;

      await page.goto(searchUrl, {
        waitUntil: 'networkidle', // 'domcontentloaded' se behtar hai dynamic content ke liye
        timeout: 45000,
      });
      try {
        await page.waitForSelector(
          '.suggestion-search, .search-suggestions, a[href*="/biz/"]',
          { timeout: 20000 },
        );
      } catch (e) {
        console.log(
          '⚠️ [N49] Suggestions/Results took too long or not found.',
          e,
        );
      }
      // FIX 4: Check karein agar Cloudflare ya block page toh nahi aa raha
      // const html = await page.content();
      // // console.log('📄 [N49 DEBUG HTML]:', html);

      // if (html.includes('Access denied') || html.includes('Cloudflare')) {
      //   console.log('❌ [N49] Blocked by Cloudflare/Bot Protection');
      //   return [];
      // }

      // 🕵️ DEBUG: Console mein sirf results wala part print karke dekho
      // const resultsContainer = await page.evaluate(() => {
      //   return (
      //     document.querySelector(
      //       '.suggestion-search, .search-suggestions, #search-results',
      //     )?.innerHTML || 'NOT FOUND'
      //   );
      // });
      // console.log('🔍 [DEBUG] Results Section HTML:', resultsContainer);

      // 1. Extracting Listing Links from Search Results
      const links = await page.evaluate(() => {
        const foundLinks: string[] = [];
        const allAnchors = Array.from(
          document.querySelectorAll('a[href*="/biz/"]'),
        );
        allAnchors.forEach((a) => {
          const href = (a as HTMLAnchorElement).href;
          if (href) foundLinks.push(href);
        });

        // Unique links nikalna aur top 3 return karna
        return [...new Set(foundLinks)].slice(0, 5);
      });

      const finalResults: LocationResponseDto[] = [];

      // 2. Deep Dive into each business link
      for (const link of links) {
        const newPage = await context.newPage();
        newPage.on('console', (msg) => {
          console.log(`🌐 [BROWSER LOG]: ${msg.text()}`);
        });
        try {
          await newPage.goto(link, {
            waitUntil: 'load',
            timeout: 20000,
          });
          await page.waitForTimeout(1000);

          const extractedData = await newPage.evaluate(() => {
            // N49 specific selectors

            const bizName =
              document.querySelector('h1, .biz-name')?.textContent || '-';

            const phoneEl = document.querySelector(
              '.biz-phone, [href^="tel:"]',
            );
            const phone = phoneEl?.textContent || '-';

            // Address extraction
            const addressEl = document.querySelector('.biz-address, .address');
            const address = addressEl?.textContent || 'N49 Listing';

            return {
              name: bizName.trim(),
              phone: phone.trim().replace(/\s+/g, ' '),
              address: address.trim().replace(/\s+/g, ' '),
            };
          });

          finalResults.push({
            name: extractedData.name !== '' ? extractedData.name : '-',
            address: extractedData.address,
            phone: extractedData.phone !== '' ? extractedData.phone : '-',
            locationLink: newPage.url(),
            source: 'N49',
            timestamp: new Date().toISOString(),
          });

          return finalResults;
        } catch (e) {
          console.log(`❌ [N49] Error scraping deep link: ${link}`, e);
        } finally {
          await newPage.close();
        }
      }

      // 3. Save to Database
      // if (finalResults.length > 0) {
      //   await this.saveResults(finalResults, name);
      // }

      return finalResults;
    } catch (error) {
      console.error('❌ [N49] Global Scraper Error:', error);
      return [];
    } finally {
      await browser.close();
    }
  }

  // async saveResults(results: LocationResponseDto[], targetName: string) {
  //   const searchKeywords = targetName.toLowerCase().split(' ');
  //   for (const item of results) {
  //     if (!item.name || item.name === '-') continue;

  //     const itemName = item.name.toLowerCase();
  //     const matchCount = searchKeywords.filter((key) =>
  //       itemName.includes(key),
  //     ).length;

  //     // 50% Match Logic
  //     if (matchCount < Math.ceil(searchKeywords.length / 2)) {
  //       console.log(`🚫 [N49] Filtering out unrelated: ${item.name}`);
  //       continue;
  //     }

  //     const existing = await this.locationRepo.findOne({
  //       where: { locationLink: item.locationLink },
  //     });
  //     if (!existing) {
  //       await this.locationRepo.save(this.locationRepo.create(item));
  //       //console.log(`💾 [N49] Saved: ${item.name}`);
  //     }
  //   }
  // }
}
