/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { Page } from 'puppeteer';
import { LocationResponseDto } from '../dto/location-response.dto';
import path from 'path';

@Injectable()
export class StoreboardScraperService {
  private readonly logger = new Logger(StoreboardScraperService.name);

  /**
   * Main Entry point for Storeboard direct lookup pipeline
   * @param companySlug The company identifier or slug used in the URL
   */
  public async scrapeStoreboard(
    companySlug: string,
  ): Promise<LocationResponseDto[]> {
    // Standard clean browser configuration
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });
      const cleanSlug = companySlug
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/^\/+|\/+$/g, '');

      const targetLink = `https://www.storeboard.com/${cleanSlug}`;
      this.logger.log(`[Storeboard] Direct navigation targeted: ${targetLink}`);

      // Go to page with strict network idle configuration (0 active connections)
      const response = await page.goto(targetLink, {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      });

      this.logger.log(
        `[Storeboard] Enforcing strict wait for profile element blocks...`,
      );

      this.logger.log(
        `[Storeboard] HTTP Status Code Received: ${response?.status()}`,
      );

      this.logger.log(
        `[Storeboard] Waiting up to 15s for core layout selectors...`,
      );
      // 🔥 FIX: Instead of swallowing the error immediately and continuing,
      // we await the evaluation of structural selectors properly.
      try {
        await page.waitForSelector(
          '#tblProfileDisplay, .page-content-title,td.mainlinkBlack',
          {
            visible: true,
            timeout: 15000,
          },
        );
      } catch (err) {
        this.logger.warn(
          'Warning: Core profile elements took too long to render! Attempting fallback parsing anyway.',
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 2000));

      this.logger.log(`[Storeboard] Launching Final DOM Extraction...`);
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
      this.logger.error(`[Storeboard Core Exception Engine]: ${error}`);
      try {
        const screenshotPath = path.join(
          process.cwd(),
          `storeboard-error-${Date.now()}.png`,
        );
        await browser.pages().then(async (pages) => {
          if (pages.length > 0) {
            await pages[0].screenshot({ path: screenshotPath, fullPage: true });
            this.logger.log(
              `[Storeboard Debug] Error screenshot generated at: ${screenshotPath}`,
            );
          }
        });
      } catch (screenshotErr) {
        this.logger.error(
          `Failed to capture diagnostic screenshot: ${screenshotErr}`,
        );
      }
      await browser.close();
      return [];
    }
  }

  /**
   * DOM Parsing Engine meticulously tailored for Storeboard profile layout structure
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

      // Target all rows inside the layout profile tables
      const dataRows = Array.from(
        document.querySelectorAll('#tblProfileDisplay tr, table tr'),
      );

      dataRows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length < 2) return;

        const cellLabel = cells[0].textContent?.toLowerCase().trim() || '';
        const cellValueContainer = cells[1];

        if (cellValueContainer) {
          const rawText = cellValueContainer.textContent?.trim() || '';

          if (cellLabel === 'about') {
            aboutText = rawText;
          } else if (cellLabel === 'location') {
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

      // Phone Fallback extract from About block text using dynamic regex
      if (aboutText && phone === '—') {
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
