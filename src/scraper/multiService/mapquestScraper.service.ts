import { Injectable, Logger } from '@nestjs/common';
import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { LocationResponseDto } from '../dto/location-response.dto';

/** Base URL for MapQuest business search */
const MAPQUEST_SEARCH_BASE = 'https://www.mapquest.com/search/';

/** Maximum number of detail page links to visit per search */
const MAX_LINKS_TO_VISIT = 6;

/**
 * Delay in milliseconds to allow dynamic content to render
 * after the initial page load on MapQuest search results.
 */
const PAGE_RENDER_DELAY_MS = 3000;

/**
 * Service responsible for scraping business location data from MapQuest
 * using a headless Chromium browser via Playwright.
 */
@Injectable()
export class MapQuestScraperService {
  private readonly logger = new Logger(MapQuestScraperService.name);

  /**
   * Scrapes MapQuest for businesses matching the given search query.
   *
   * @param query - Search term (e.g. "Airdrie Choice Dental Alberta")
   * @returns A promise resolving to an array of matched LocationResponseDto objects
   */
  async scrapeMapQuest(query: string): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    });

    try {
      return await this.performScraping(browser, query);
    } catch (error) {
      this.logger.error(
        `[MapQuest] Global scraper error: ${error instanceof Error ? error.message : String(error)}`,
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
   * build URL → wait for render → collect links → visit each detail page.
   *
   * @param browser - Active Playwright Browser instance
   * @param query   - Original search query string
   * @returns All matched location results
   */
  private async performScraping(
    browser: Browser,
    query: string,
  ): Promise<LocationResponseDto[]> {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    const searchUrl = `${MAPQUEST_SEARCH_BASE}${encodeURIComponent(query)}`;
    this.logger.log(`[MapQuest] Searching: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 40000,
    });

    // MapQuest renders results dynamically — wait for JS to settle
    await page.waitForTimeout(PAGE_RENDER_DELAY_MS);

    const detailLinks = await this.collectDetailLinks(page);
    this.logger.log(`[MapQuest] Found ${detailLinks.length} detail links`);

    return this.visitDetailPages(context, detailLinks, query);
  }

  /**
   * Extracts unique business detail page URLs from the MapQuest search results.
   * Filters out navigation, search, and directions links — keeping only
   * deep business profile links (URL depth > 5 segments).
   *
   * @param page - Playwright Page showing MapQuest search results
   * @returns Deduplicated array of business detail URLs (capped at MAX_LINKS_TO_VISIT)
   */
  private async collectDetailLinks(page: Page): Promise<string[]> {
    return page.evaluate((maxLinks: number) => {
      return Array.from(document.querySelectorAll('a'))
        .map((anchor) => anchor.href)
        .filter(
          (href) =>
            href.includes('mapquest.com/') &&
            href.split('/').length > 5 && // Only deep business profile links
            !href.includes('/search') &&
            !href.includes('/directions'),
        )
        .filter((href, index, self) => self.indexOf(href) === index) // Deduplicate
        .slice(0, maxLinks);
    }, MAX_LINKS_TO_VISIT);
  }

  /**
   * Iterates over detail page links and collects all results whose
   * business name closely matches the original search query.
   *
   * Matching is case-insensitive and strips non-alphanumeric characters
   * so punctuation and spacing differences are ignored.
   *
   * @param context - Playwright BrowserContext used to open new tabs
   * @param links   - Business detail page URLs to visit
   * @param query   - Original search query used for name matching
   * @returns Array of all matched LocationResponseDto results
   */
  private async visitDetailPages(
    context: BrowserContext,
    links: string[],
    query: string,
  ): Promise<LocationResponseDto[]> {
    const targetClean = this.normalizeForComparison(query);
    const results: LocationResponseDto[] = [];

    for (const link of links) {
      const detailPage = await context.newPage();

      try {
        await detailPage.goto(link, {
          waitUntil: 'domcontentloaded',
          timeout: 25000,
        });

        const extracted = await this.extractBusinessDetails(detailPage, link);
        const foundClean = this.normalizeForComparison(extracted.name);

        const isMatch =
          foundClean.includes(targetClean) || targetClean.includes(foundClean);

        if (isMatch) {
          this.logger.log(`[MapQuest] Match found: "${extracted.name}"`);
          results.push({
            name: extracted.name,
            address: extracted.address,
            phone: extracted.phone,
            locationLink: link,
            source: 'MapQuest',
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        this.logger.warn(
          `[MapQuest] Failed to scrape detail page ${link}: ` +
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
   * Extracts structured business details from a MapQuest business detail page.
   * Uses multiple selector fallbacks for address to handle varying page layouts.
   * Phone number is extracted from the tel: href for accuracy over display text.
   *
   * @param page       - Playwright Page loaded with the business detail URL
   * @param sourceLink - The URL of the detail page, used as locationLink
   * @returns Raw extracted business data
   */
  private async extractBusinessDetails(
    page: Page,
    sourceLink: string,
  ): Promise<RawBusinessDetail> {
    return page.evaluate((link: string): RawBusinessDetail => {
      // Prefer h1; fall back to infosheet header innerHTML
      const name =
        document.querySelector('h1')?.innerText ??
        document.querySelector('[data-testid="infosheet-header"]')?.innerHTML ??
        '—';

      // Try multiple address selectors to handle layout variations
      const address =
        (
          document.querySelector('[data-testid="details-address-text"]') ??
          document.querySelector('.address-container span') ??
          document.querySelector('.address')
        )?.textContent
          ?.trim()
          .replace(/\s+/g, ' ') ?? '—';

      // Extract phone from tel: href — more reliable than display text
      const telHref = document
        .querySelector('[data-testid="bento-call"]')
        ?.getAttribute('href');
      const phone = telHref ? telHref.replace('tel:', '').trim() : '—';

      return { name: name.trim(), address, phone, locationLink: link };
    }, sourceLink);
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

/** Shape of raw data extracted from a MapQuest business detail page */
interface RawBusinessDetail {
  name: string;
  address: string;
  phone: string;
  locationLink: string;
}
