import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright';
// import { Location } from '../location.entity';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';

@Injectable()
export class InstagramScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }

  async scrapeInstagram(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    console.log(`📸 Instagram Search Started for: ${name}`);

    // Server-friendly launch arguments
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
      // TRICK: Direct Instagram search ke bajaye Google ka use karke Instagram profiles dhundna
      // Ye block hone se bachata hai
      const searchQuery = encodeURIComponent(
        `site:instagram.com "${name}" ${location}`,
      );
      const searchUrl = `https://www.google.com/search?q=${searchQuery}`;

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });

      const profiles = await page.evaluate(() => {
        const results = Array.from(document.querySelectorAll('div.g'));
        return results
          .map((el) => {
            const link = el.querySelector('a')?.href;
            const title = el.querySelector('h3')?.innerText || '';
            // Google snippet se bio/description nikalna
            const snippet = el.querySelector('.VwiC3b')?.textContent || '';

            if (link && link.includes('instagram.com/')) {
              return { link, title, snippet };
            }
            return null;
          })
          .filter(Boolean);
      });

      const finalResults: LocationResponseDto[] = [];

      for (const profile of profiles.slice(0, 2)) {
        const newPage = await context.newPage();
        try {
          await newPage.goto(profile!.link, {
            waitUntil: 'networkidle',
            timeout: 20000,
          });

          // Instagram Page se data nikalna
          const data = await newPage.evaluate((searchName) => {
            // Instagram aksar login popup dikhata hai, isliye hum Title aur Meta tags se data nikalenge
            const metaTitle = document.title;
            const nameFromTitle = metaTitle.split('•')[0] || searchName;

            // Bio se phone number dhundna (Regex)
            const bodyText = document.body.innerText;
            const phoneMatch = bodyText.match(
              /(\+?\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/,
            );

            return {
              name: nameFromTitle.replace('(@', ' - ').replace(')', '').trim(),
              phone: phoneMatch ? phoneMatch[0] : '-',
              address: 'Instagram Profile Bio',
            };
          }, name);
          // 🔥 PUSH SE PEHLE CONSOLE LOG
          console.log(`✅ Extracted Data:`);
          console.log(`   Name:  ${data.name}`);
          console.log(`   Phone: ${data.phone}`);
          console.log(`   Link:  ${profile!.link}`);
          finalResults.push({
            ...data,
            locationLink: profile!.link,
            source: 'Instagram',
            timestamp: new Date().toISOString(),
          });
        } catch (e) {
          console.log(
            `⚠️ Could not deep scrape Instagram profile: ${profile!.link}`,
            e,
          );
        } finally {
          await newPage.close();
        }
      }

      // if (finalResults.length > 0) {
      //   await this.saveResults(finalResults, name);
      // }

      return finalResults;
    } catch (error) {
      console.error('❌ Instagram Scraper Error:', error);
      return [];
    } finally {
      await browser.close();
    }
  }

  // Same robust save logic
  // async saveResults(results: LocationResponseDto[], targetName: string) {
  //   const searchKeywords = targetName.toLowerCase().split(' ');
  //   for (const item of results) {
  //     if (!item.name || item.name === '-') continue;

  //     const itemName = item.name.toLowerCase();
  //     const matchCount = searchKeywords.filter((key) =>
  //       itemName.includes(key),
  //     ).length;

  //     if (matchCount < Math.ceil(searchKeywords.length / 2)) continue;

  //     const existing = await this.locationRepo.findOne({
  //       where: { locationLink: item.locationLink },
  //     });
  //     if (!existing) {
  //       await this.locationRepo.save(this.locationRepo.create(item));
  //     } else {
  //       await this.locationRepo.update(existing.id, item);
  //     }
  //   }
  // }
}
