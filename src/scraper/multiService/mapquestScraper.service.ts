import { Injectable, Logger } from '@nestjs/common';
import { Browser, chromium, Page } from 'playwright';
import { LocationResponseDto } from '../dto/location-response.dto';

/** Base URL for MapQuest business search */
const MAPQUEST_SEARCH_BASE = 'https://www.mapquest.com/search/';

/** Maximum number of search result cards to extract directly from the page layout */
const MAX_RESULTS_TO_PROCESS = 6;

/**
 * Service responsible for scraping business location data from MapQuest
 * using a highly optimized, headless Chromium instance via Playwright.
 * * Performance Tuning: This implementation bypasses heavy detail-page jumps
 * by extracting data directly from DOM elements found on the primary results feed.
 */
@Injectable()
export class MapQuestScraperService {
  private readonly logger = new Logger(MapQuestScraperService.name);

  /**
   * Scrapes MapQuest for businesses matching the given search query.
   *
   * @param query - Search term (e.g. "Airdrie Choice Dental")
   * @returns A promise resolving to an array of matched LocationResponseDto objects
   */
  async scrapeMapQuest(query: string): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        // Optimization: Stop rendering assets like images at the engine level to conserve bandwidth
        '--blink-settings=imagesEnabled=false',
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
      // Always guarantee the browser instance releases system memory resources
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Orchestrates the direct scraping workflow: Intercepts assets, navigates,
   * reactively waits for nodes, and maps matches cleanly.
   *
   * @param browser - Active Playwright Browser instance
   * @param query   - Original search query string
   * @returns Matched location results
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

    // Optimization: Block network requests for heavy visual dependencies that don't impact text extraction
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(resourceType)) {
        return route.abort();
      }
      return route.continue();
    });

    const searchUrl = `${MAPQUEST_SEARCH_BASE}${encodeURIComponent(query)}`;
    this.logger.log(`[MapQuest] Searching: ${searchUrl}`);

    // Speed Optimization: "commit" lets us evaluate data immediately when HTML payload lands
    await page.goto(searchUrl, {
      waitUntil: 'commit',
      timeout: 30000,
    });

    // Optimization: Reactive dynamic wait. Program moves instantly the exact millisecond content appears
    const cardSelector = 'a[role="listitem"][data-testid="search-card"]';
    try {
      await page
        .locator(cardSelector)
        .first()
        .waitFor({ state: 'visible', timeout: 8000 });
    } catch {
      this.logger.warn(
        `[MapQuest] Timeout waiting for search cards to appear in the DOM.`,
      );
      return [];
    }

    // Safely extract structural business nodes right out of the browser sandbox execution context
    const extractedCards = await this.extractCardsFromPage(
      page,
      MAX_RESULTS_TO_PROCESS,
    );
    this.logger.log(
      `[MapQuest] Harvested ${extractedCards.length} raw profile components from page.`,
    );

    const targetClean = this.normalizeForComparison(query);
    const results: LocationResponseDto[] = [];

    // Filter, validate, and build standardized objects
    for (const card of extractedCards) {
      // Skip element entry placeholders that failed structural processing
      if (card.name === '—') continue;

      const foundClean = this.normalizeForComparison(card.name);
      const isMatch =
        foundClean.includes(targetClean) || targetClean.includes(foundClean);

      if (isMatch) {
        this.logger.log(
          `[MapQuest] Match found on layout stream: "${card.name}"`,
        );
        results.push({
          name: card.name,
          address: card.address,
          phone: card.phone,
          locationLink: card.locationLink,
          source: 'MapQuest',
          timestamp: new Date().toISOString(),
        });
      }
    }

    return results;
  }

  /**
   * Targets the search result list components dynamically from the active page view.
   * Uses isolation patterns so localized structural mutations don't kill the worker.
   *
   * @param page       - The active Playwright page resource
   * @param maxResults - Upper constraint on items evaluated
   * @returns Array of raw data collections extracted from elements
   */
  private async extractCardsFromPage(
    page: Page,
    maxResults: number,
  ): Promise<RawBusinessDetail[]> {
    return page.evaluate((limit) => {
      // Targets the search result <a> wrapper anchors seen in the DevTools snapshot
      const anchors = Array.from(
        document.querySelectorAll(
          'a[role="listitem"][data-testid="search-card"]',
        ),
      );

      return anchors.slice(0, limit).map((anchor) => {
        try {
          const htmlAnchor = anchor as HTMLAnchorElement;

          // 1. Link Extraction: Grab profile target URL directly from the card container layout
          const locationLink = htmlAnchor.href || '';

          // 2. Name Extraction: Target the specific header tag inside the card container text space
          const nameEl = htmlAnchor.querySelector('h3');
          const name = nameEl ? nameEl.innerText.trim() : '—';

          // 3. Address Extraction: Pull interior block elements cleanly
          const addressBlock = htmlAnchor.querySelector(
            '[data-testid="search-card-address"]',
          );
          let address = '—';
          if (addressBlock) {
            // Locate component spans to divide street segments cleanly from city/state values
            const spans = Array.from(addressBlock.querySelectorAll('span'));
            address =
              spans.length > 0
                ? spans
                    .map((span) => span.innerText.trim())
                    .filter(Boolean)
                    .join(', ')
                : (addressBlock as HTMLElement).innerText
                    .trim()
                    .replace(/\s+/g, ' '); // Inline text string fallback
          }

          // 4. Phone Extraction: Grab structural dial strings by testing target attributes
          const phoneEl = htmlAnchor.querySelector(
            '[data-testid="search-card-phone"]',
          );
          const phone = phoneEl
            ? (phoneEl as HTMLElement).innerText.trim()
            : '—';

          return { name, address, phone, locationLink };
        } catch {
          // Failure Boundary: Keep worker alive if a rogue A/B variant item card layout breaks structural parsing
          return { name: '—', address: '—', phone: '—', locationLink: '' };
        }
      });
    }, maxResults);
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

/** Shape of raw data extracted directly from a MapQuest business card element */
interface RawBusinessDetail {
  name: string;
  address: string;
  phone: string;
  locationLink: string;
}
