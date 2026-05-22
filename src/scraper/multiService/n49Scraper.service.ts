import { Injectable, Logger } from '@nestjs/common';
import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { LocationResponseDto } from '../dto/location-response.dto';

/** Base URL pattern for N49 business search */
const N49_SEARCH_BASE = 'https://www.n49.com/search/';

/** N49 category code for dental/health businesses */
const N49_CATEGORY_CODE = '42041';

/** Maximum number of business detail links to visit per search */
const MAX_LINKS_TO_VISIT = 5;

/**
 * Service responsible for scraping business location data from N49.com
 * using a headless Chromium browser via Playwright.
 */
@Injectable()
export class N49ScraperService {
  private readonly logger = new Logger(N49ScraperService.name);

  /**
   * Scrapes N49.com for a business matching the given name and location.
   *
   * @param name     - Business name to search for (e.g. "Airdrie Choice Dental")
   * @param location - Comma-separated location string (e.g. "123 Main St, Airdrie, AB")
   * @returns A promise resolving to matched LocationResponseDto entries
   */
  async scrapeN49(
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
        `[N49] Global scraper error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    } finally {
      // Always release the browser resource regardless of outcome
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Orchestrates the full scraping flow:
   * resolve city → build URL → wait for results → collect links → visit detail pages.
   *
   * @param browser  - Active Playwright Browser instance
   * @param name     - Target business name
   * @param location - Raw location string to extract city/zip from
   * @returns All matched location results
   */
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
    const searchUrl =
      `${N49_SEARCH_BASE}${encodeURIComponent(name)}/` +
      `${N49_CATEGORY_CODE}/${encodeURIComponent(cityOrZip)}/`;

    this.logger.log(`[N49] Searching: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'networkidle',
      timeout: 45000,
    });

    await this.waitForSearchResults(page);

    const detailLinks = await this.collectDetailLinks(page);
    this.logger.log(`[N49] Found ${detailLinks.length} detail links`);

    return this.visitDetailPages(context, detailLinks, name);
  }

  /**
   * Waits for N49 search result elements to appear in the DOM.
   * Logs a warning if results are slow or absent — does not throw,
   * allowing the scraper to continue and attempt link extraction anyway.
   *
   * @param page - Playwright Page showing N49 search results
   */
  private async waitForSearchResults(page: Page): Promise<void> {
    try {
      await page.waitForSelector(
        '.suggestion-search, .search-suggestions, a[href*="/biz/"]',
        { timeout: 20000 },
      );
    } catch {
      this.logger.warn(
        '[N49] Search results took too long to load or were not found — proceeding anyway',
      );
    }
  }

  /**
   * Extracts unique business detail page URLs from the N49 search results.
   * Only collects links containing "/biz/" in their href.
   *
   * @param page - Playwright Page showing N49 search results
   * @returns Deduplicated array of business detail URLs (capped at MAX_LINKS_TO_VISIT)
   */
  private async collectDetailLinks(page: Page): Promise<string[]> {
    return page.evaluate((maxLinks: number) => {
      const hrefs = Array.from(
        document.querySelectorAll('a[href*="/biz/"]'),
      ).map((anchor) => (anchor as HTMLAnchorElement).href);

      return [...new Set(hrefs)].slice(0, maxLinks);
    }, MAX_LINKS_TO_VISIT);
  }

  /**
   * Iterates over detail page links and returns all results whose
   * business name closely matches the target name.
   *
   * NOTE: Previously this method had a bug where `return` was placed
   * inside the loop, causing it to exit after the very first result.
   * This is now fixed — all matching links are evaluated.
   *
   * @param context    - Playwright BrowserContext used to open new tabs
   * @param links      - Business detail page URLs to visit
   * @param targetName - Original business name used for fuzzy matching
   * @returns Array of all matched LocationResponseDto results
   */
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

        // Wait for dynamic content on the correct page (detailPage, not search page)
        await detailPage.waitForTimeout(1000);

        const extracted = await this.extractBusinessDetails(detailPage);
        const foundClean = this.normalizeForComparison(extracted.name);

        const isMatch =
          foundClean.includes(targetClean) || targetClean.includes(foundClean);

        if (isMatch) {
          this.logger.log(`[N49] Match found: "${extracted.name}"`);
          results.push({
            name: extracted.name,
            address: extracted.address,
            phone: extracted.phone,
            locationLink: detailPage.url(),
            source: 'N49',
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        this.logger.warn(
          `[N49] Failed to scrape detail page ${link}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        // Always close the tab — even if an error was thrown
        await detailPage.close();
      }
    }

    return results;
  }

  /**
   * Extracts structured business details from an N49 business detail page.
   *
   * @param page - Playwright Page loaded with the business detail URL
   * @returns Raw extracted business data
   */
  private async extractBusinessDetails(page: Page): Promise<RawBusinessDetail> {
    return page.evaluate((): RawBusinessDetail => {
      const name =
        document.querySelector('h1, .biz-name')?.textContent?.trim() ?? '—';

      // Phone: prefer tel: href element; fall back to text content
      const phone =
        document
          .querySelector('.biz-phone, [href^="tel:"]')
          ?.textContent?.trim()
          .replace(/\s+/g, ' ') ?? '—';

      // Address: fall back to a generic N49 listing label if absent
      const address =
        document
          .querySelector('.biz-address, .address')
          ?.textContent?.trim()
          .replace(/\s+/g, ' ') ?? 'N49 Listing';

      return { name, phone, address };
    });
  }

  /**
   * Extracts the city or zip code from a comma-separated location string.
   * Takes the second segment if available, otherwise falls back to the
   * last whitespace-delimited word.
   *
   * @param location - Raw location string (e.g. "123 Main St, Airdrie, AB")
   * @returns Trimmed city name or zip code string
   */
  private extractCityOrZip(location: string): string {
    return (
      location.split(',')[1]?.trim() || location.split(' ').pop() || location
    );
  }

  /**
   * Normalizes a string for fuzzy name comparison by lowercasing
   * and removing all non-alphanumeric characters.
   *
   * @param value - Raw string to normalize
   * @returns Cleaned lowercase alphanumeric string
   */
  private normalizeForComparison(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** Shape of raw data extracted from an N49 business detail page */
interface RawBusinessDetail {
  name: string;
  phone: string;
  address: string;
}
