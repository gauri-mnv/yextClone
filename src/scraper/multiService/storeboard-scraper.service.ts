/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { Page } from 'puppeteer';
import { LocationResponseDto } from '../dto/location-response.dto';

@Injectable()
export class StoreboardScraperService {
  private readonly logger = new Logger(StoreboardScraperService.name);

  /**
   * Main Entry point for Storeboard direct lookup pipeline
   * @param companySlug The company identifier or slug used in the URL (e.g., 'SwanavonDentalClinic' or 'airdriechoicedental')
   */
  public async scrapeStoreboard(
    companySlug: string,
  ): Promise<LocationResponseDto[]> {
    // Standard clean browser configuration
    const browser = await puppeteer.launch({
      headless: true, // Turn true for headless server deployments
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // Performance booster: Intercept and abort resource-heavy tracking frames or images
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    // 🔥 FIX: Spaces ko hatao, sab kuch lowercase karo aur slashes clean karo
    const cleanSlug = companySlug
      .toLowerCase() // Sab kuch lowercase karne ke liye
      .replace(/\s+/g, '') // Saari spaces hatane ke liye (Airdrie Choice Dental -> airdriechoicedental)
      .replace(/^\/+|\/+$/g, ''); // Aage-piche ke extra slashes hatane ke liye

    const targetLink = `https://www.storeboard.com/${cleanSlug}`;

    try {
      this.logger.log(`[Storeboard] Direct navigation targeted: ${targetLink}`);

      // Go to page with strict timeout configuration
      await page.goto(targetLink, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });
      // Confirm we didn't hit an error or empty profile page
      this.logger.log(`[Storeboard] Waiting for profile container element...`);
      // await page
      //   .waitForSelector('.page-content_pofile', { timeout: 30000 })
      //   .catch(() => {
      //     this.logger.warn('Warning:.page-content_pofile not found in time!');
      //   });

      this.logger.log(
        `[Storeboard] Waiting strictly for structural elements...`,
      );

      await page
        .waitForSelector('#tblProfileDisplay, td.mainlinkBlack, h1', {
          timeout: 20000,
        })
        .catch(() => {
          this.logger.warn(
            'Warning: Core profile elements took too long to render!',
          );
        });

      // Safe buffer sync pause
      await new Promise((resolve) => setTimeout(resolve, 3000));
      // Extract raw data structures out of specific key matrix markers
      const extracted = await this.parseProfileFields(page);

      // Handle cases where the company slug might be completely invalid
      if (
        extracted.name === '—' &&
        extracted.address === '—' &&
        extracted.phone === '—'
      ) {
        this.logger.warn(
          `[Storeboard] Profiling parsed empty data fields. Valid page might not exist.`,
        );
        await browser.close();
        return [];
      }

      const result: LocationResponseDto = {
        name: extracted.name,
        address: extracted.address,
        phone: extracted.phone,
        locationLink:
          extracted.website && extracted.website !== '—'
            ? extracted.website
            : targetLink,
        source: 'Storeboard',
        timestamp: new Date().toISOString(),
      };

      await browser.close();
      return [result];
    } catch (error) {
      this.logger.error(
        `[Storeboard Core Exception Engine]: ${error || error}`,
      );
      await browser.close();
      return [];
    }
  }

  /**
   * DOM Parsing Engine meticulously tailored for Storeboard profile layout structure
   * Built from specific DOM element node targets shown in visual inspector panels
   */
  /**
   * Final Bulletproof DOM Parsing Engine
   */
  private async parseProfileFields(page: Page): Promise<{
    name: string;
    address: string;
    phone: string;
    website: string;
  }> {
    page.on('console', (msg) =>
      this.logger.debug(`[Browser Console] ${msg.text()}`),
    );

    return page.evaluate(() => {
      console.log('--- Starting Final DOM Extraction ---');

      const nameElement =
        document.querySelector('td.mainlinkBlack.size18 h1 span') ||
        document.querySelector('.page-content-title h1 span') ||
        document.querySelector('td.mainlinkBlack.size18 h1');

      const name = nameElement?.textContent?.trim() || '—';
      console.log(`Strictly Extracted Name: "${name}"`);
      let address = '—';
      let phone = '—';
      let website = '—';
      let aboutText = '';

      // 2. Target all rows inside the main layout profile table
      const dataRows = Array.from(
        document.querySelectorAll('  #tblProfileDisplay tr, table tr'),
      );

      dataRows.forEach((row) => {
        // Row ke andar ke saare td elements nikalen
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 2) return; // Agar row me label aur value nahi h, toh skip karein

        // Pehla td hamesha label hota hai (e.g., "About", "Location")
        const cellLabel = cells[0].textContent?.toLowerCase().trim() || '';

        // Dusra td container hota hai jisme actual data hota hai
        const cellValueContainer = cells[1];

        if (cellValueContainer) {
          // Pure container ka text default plain extract nikalen
          const rawText = cellValueContainer.textContent?.trim() || '';

          if (cellLabel === 'about') {
            aboutText = rawText;
          } else if (cellLabel === 'location') {
            // Inner cell content clean check (apke screenshot ke mainlinkBlack check ke sath)
            const deepText =
              cellValueContainer.querySelector('.mainlinkBlack')?.textContent ||
              rawText;
            address = deepText
              .replace(/\s+/g, ' ')
              .replace(/Map It!/i, '')
              .trim();
          } else if (cellLabel === 'website') {
            const linkAnchor = cellValueContainer.querySelector('a');
            if (linkAnchor && linkAnchor.href) {
              website = linkAnchor.href.trim();
            } else if (rawText.startsWith('http')) {
              website = rawText.trim();
            }
          }
        }
      });

      // 3. Phone Fallback extract from About block text using dynamic regex
      if (aboutText) {
        const phoneRegex =
          /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
        const matchedPhones = aboutText.match(phoneRegex);

        if (matchedPhones && matchedPhones.length > 0) {
          phone = matchedPhones[0].trim();
        }
      }

      console.log(
        `Final Outputs -> Name: ${name}, Address: ${address}, Phone: ${phone}, Website: ${website}`,
      );
      return { name, address, phone, website };
    });
  }
}
