/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
import { getPincodeFromAddress } from '../utils/location-helper';

@Injectable()
export class OpendiScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeOpendi(
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
      // Opendi Search URL Pattern: opendi.ca/s/[BusinessName]/[Location]
      const searchQuery = encodeURIComponent(name);
      const pincode = await getPincodeFromAddress(page, location);
      const searchLocation = encodeURIComponent(pincode);
      const searchUrl = `https://www.opendi.ca/search?what=${searchQuery}&where=${searchLocation}`;
      //   https://www.opendi.ca/search?what=Airdrie+Choice+Dental&where=403&searchtype=industry&submit=Search

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const links = await page.evaluate(() => {
        const selectors = [
          'a.details',
          'a[href*="/details/"]',
          '.search-result h3 a',
          'a[href^="https://www.opendi.ca/"]',
        ];

        const found: string[] = [];

        selectors.forEach((sel) => {
          const elements = Array.from(document.querySelectorAll(sel));
          elements.forEach((el) => {
            const href = (el as HTMLAnchorElement).href;
            // Filter: Sirf wo links jo search/auth pages nahi hain
            if (
              href &&
              !href.includes('/search?') &&
              !href.includes('create-a-listing')
            ) {
              found.push(href);
            }
          });
        });

        return [...new Set(found)].slice(0, 5);
      });
      const finalResults: LocationResponseDto[] = [];

      for (const link of links) {
        const newPage = await context.newPage();
        try {
          await newPage.goto(link, {
            waitUntil: 'domcontentloaded',
            timeout: 20000,
          });

          const extractedData = await newPage.evaluate((currentLink) => {
            const bizName =
              document.querySelector('.name h2, h1')?.textContent || '-';
            const getDDByDT = (term: string) => {
              const dt = Array.from(document.querySelectorAll('dt')).find(
                (el) =>
                  el.textContent
                    ?.trim()
                    .toLowerCase()
                    .includes(term.toLowerCase()),
              );
              return dt ? dt.nextElementSibling?.textContent?.trim() : null;
            };

            const address = getDDByDT('Address') || '-';
            const place = getDDByDT('Place') || '';
            const phone = getDDByDT('Landline') || getDDByDT('Phone') || '-';
            const website =
              document
                .querySelector('dd a[href^="http"]')
                ?.getAttribute('href') || '-';

            return {
              name: bizName.trim(),
              phone: phone.trim(),
              address: `${address} ${place}`.trim().replace(/\s+/g, ' '),
              locationLink: website ? website : currentLink,
            };
          }, link);

          finalResults.push({
            name: extractedData.name,
            address: extractedData.address,
            phone: extractedData.phone,
            locationLink: link,
            source: 'Opendi',
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          alert(`❌ [Opendi] Error deep searching: ${link} - ${e}`);
        } finally {
          await newPage.close();
        }
      }

      // if (finalResults.length > 0) {
      //   await this.saveResults(finalResults, name);
      // }

      return finalResults;
    } catch (error) {
      alert(`❌ [Opendi] Global Scraper Error: ${error}`);
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
  //     if (matchCount < Math.ceil(searchKeywords.length / 2)) continue;

  //     const existing = await this.locationRepo.findOne({
  //       where: { locationLink: item.locationLink },
  //     });
  //     if (!existing) {
  //       await this.locationRepo.save(this.locationRepo.create(item));
  //       // console.log(`💾 [Opendi] Saved: ${item.name}`);
  //     }
  //   }
  // }
}
