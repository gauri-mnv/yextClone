import { Injectable, Logger } from '@nestjs/common';
import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { LocationResponseDto } from '../dto/location-response.dto';

/** Base URL pattern for Acompio business search */
const ACOMPIO_SEARCH_BASE = 'https://www.acompio.ca/search.php';

/** Maximum number of business detail links to visit per search */
const MAX_LINKS_TO_VISIT = 5;

@Injectable()
export class AcompioScraperService {
  private readonly logger = new Logger(AcompioScraperService.name);

  async scrapeAcompio(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      return await this.performScraping(browser, name, location);
    } catch (error) {
      this.logger.error(
        `[Acompio] Global scraper error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    } finally {
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  private async performScraping(
    browser: Browser,
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    const cityOrZip = this.extractCityOrZip(location);
    const searchUrl = `${ACOMPIO_SEARCH_BASE}?name=${encodeURIComponent(name)}&place=${encodeURIComponent(cityOrZip)}`;

    this.logger.log(`[Acompio] Searching: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'networkidle',
      timeout: 45000,
    });

    await this.waitForSearchResults(page);

    const detailLinks = await this.collectDetailLinks(page);
    this.logger.log(`[Acompio] Found ${detailLinks.length} detail links`);

    return this.visitDetailPages(context, detailLinks, name);
  }

  private async waitForSearchResults(page: Page): Promise<void> {
    try {
      await page.waitForSelector('a[href$=".html"]', { timeout: 20000 });
    } catch {
      this.logger.warn(
        '[Acompio] Search results took too long to load or were not found — proceeding anyway',
      );
    }
  }

  private async collectDetailLinks(page: Page): Promise<string[]> {
    return page.evaluate((maxLinks: number) => {
      const anchors = Array.from(document.querySelectorAll('a[href$=".html"]'));
      const hrefs = anchors
        .map((anchor) => (anchor as HTMLAnchorElement).href)
        .filter(
          (href) =>
            !href.includes('search.php') && !href.includes('index.html'),
        );

      return [...new Set(hrefs)].slice(0, maxLinks);
    }, MAX_LINKS_TO_VISIT);
  }

  private async visitDetailPages(
    context: BrowserContext,
    links: string[],
    targetName: string,
  ): Promise<LocationResponseDto[]> {
    const targetClean = this.normalizeForComparison(targetName);
    const results: LocationResponseDto[] = [];

    for (const link of links) {
      const detailPage = await context.newPage();

      try {
        await detailPage.goto(link, {
          waitUntil: 'load',
          timeout: 20000,
        });

        await detailPage.waitForTimeout(1000);

        const extracted = await this.extractBusinessDetails(detailPage);
        const foundClean = this.normalizeForComparison(extracted.name);

        const isMatch =
          foundClean.includes(targetClean) || targetClean.includes(foundClean);

        if (isMatch) {
          this.logger.log(`[Acompio] Match found: "${extracted.name}"`);
          results.push({
            name: extracted.name,
            address: extracted.address,
            phone: extracted.phone,
            // Fall back to the detail page URL if the company doesn't have a website listed
            locationLink:
              extracted.website !== '—' ? extracted.website : detailPage.url(),
            source: 'Acompio',
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        this.logger.warn(
          `[Acompio] Failed to scrape detail page ${link}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        await detailPage.close();
      }
    }

    return results;
  }

  /**
   * Extracts structured business details from an Acompio business detail page.
   */
  private async extractBusinessDetails(page: Page): Promise<RawBusinessDetail> {
    return page.evaluate((): RawBusinessDetail => {
      // 1. Business Name
      const name =
        document.querySelector('#title h1')?.textContent?.trim() ?? '—';

      // 2. Phone
      const phoneElement = document.querySelector(
        '#phone p.has-text-black-bis',
      );
      const phone =
        phoneElement?.textContent?.trim().replace(/\s+/g, ' ') ?? '—';

      // 3. Address
      const placeElement = document.querySelector('#place');
      let address = 'Acompio Listing';

      if (placeElement) {
        const lines = Array.from(placeElement.querySelectorAll('p, span a'))
          .map((el) => el.textContent?.trim())
          .filter((text) => text && !text.includes('icon'));

        if (lines.length > 0) {
          address = [...new Set(lines)].join(', ').replace(/\s+/g, ' ');
        }
      }

      // 4. Target Business Website (From your new screenshot)
      const websiteAnchor = document.querySelector(
        'a.button.is-dark[href^="http"]',
      );
      const website = (websiteAnchor as HTMLAnchorElement)?.href ?? '—';

      return { name, phone, address, website };
    });
  }

  private extractCityOrZip(location: string): string {
    return (
      location.split(',')[1]?.trim() || location.split(' ').pop() || location
    );
  }

  private normalizeForComparison(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

interface RawBusinessDetail {
  name: string;
  phone: string;
  address: string;
  website: string; // Added field to pass the parsed website anchor
}
