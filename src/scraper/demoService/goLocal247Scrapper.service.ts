import { Injectable, Logger } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';

/**
 * Register the Stealth plugin once at module load time so that all
 * Chromium instances launched by this service bypass basic bot detection.
 */
puppeteer.use(StealthPlugin());

/** Maximum number of listings to evaluate when finding the best match */
const MAX_LISTINGS = 10;

/**
 * Ordered list of CSS selectors used to find business listing links.
 * More specific selectors are tried first; fallback to any /biz/ link.
 */
const LISTING_LINK_SELECTORS = [
  'h3 a[href*="/biz/"]',
  '.result-title a[href*="/biz/"]',
  'a.business-name[href*="/biz/"]',
  'a[href*="/biz/"]', // broadest fallback
] as const;

/**
 * Service responsible for scraping business location data from GoLocal247
 * using a stealth headless Puppeteer browser.
 */
@Injectable()
export class GoLocalScraperService {
  private readonly logger = new Logger(GoLocalScraperService.name);

  /**
   * Scrapes GoLocal247 for a business matching the given name and location.
   *
   * @param name     - Business name to search for (e.g. "Airdrie Choice Dental")
   * @param location - Location string (e.g. "Airdrie, AB" or "123 Main St, Airdrie, AB")
   * @returns A promise resolving to a single matched LocationResponseDto, or empty array
   */
  async scrapeGoLocal(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await this.launchBrowser();

    try {
      return await this.performScraping(browser, name, location);
    } catch (error) {
      this.logger.error(
        `[GoLocal247] Scraper error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    } finally {
      // Always release browser resource regardless of outcome
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Orchestrates the full scraping flow:
   * build URL → wait for listings → match best result → extract detail page.
   *
   * @param browser  - Active Puppeteer Browser instance
   * @param name     - Target business name
   * @param location - Raw location string
   * @returns Matched location result wrapped in an array, or empty array
   */
  private async performScraping(
    browser: Browser,
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const page = await this.newStealthPage(browser);

    const searchUrl = this.buildSearchUrl(name, location);
    this.logger.log(`[GoLocal247] Searching: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Step 1: Try each selector in order — use the first one that finds results
    const listings = await this.collectListings(page);

    if (!listings.length) {
      this.logger.warn(
        `[GoLocal247] No listings found for "${name}" — page may have changed or be blocked`,
      );
      return [];
    }

    this.logger.log(`[GoLocal247] Found ${listings.length} listings`);

    // Step 2: Pick the listing whose name best matches the query
    const bestMatch = this.findBestMatch(listings, name);
    this.logger.log(
      `[GoLocal247] Best match: "${bestMatch.name}" → ${bestMatch.link}`,
    );

    // Step 3: Navigate to detail page and extract structured data
    await page.goto(bestMatch.link, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for business name heading — confirms detail page loaded correctly
    await page
      .waitForSelector('h1.yext-name, h1', { timeout: 15000 })
      .catch(() =>
        this.logger.warn(
          '[GoLocal247] h1.yext-name not found — attempting extraction anyway',
        ),
      );

    const details = await this.extractBusinessDetails(page);
    this.logger.log(`[GoLocal247] Match found: "${details.name}"`);

    return [
      {
        ...details,
        source: 'GoLocal247',
        locationLink: bestMatch.link,
        timestamp: new Date().toISOString(),
      },
    ];
  }

  /**
   * Tries each selector in LISTING_LINK_SELECTORS in order and returns
   * the first non-empty set of listing results found on the page.
   *
   * This multi-selector approach handles GoLocal247 layout variations
   * and is the fix for the `a[href*="/biz/"]` timeout error — instead of
   * hard-waiting for one selector, we probe multiple selectors gracefully.
   *
   * @param page - Playwright Page showing GoLocal247 search results
   * @returns Deduplicated array of listing name+link objects
   */
  private async collectListings(
    page: Page,
  ): Promise<{ name: string; link: string }[]> {
    for (const selector of LISTING_LINK_SELECTORS) {
      try {
        // Short timeout — if selector not present, move to next one quickly
        await page.waitForSelector(selector, { timeout: 5000 });
      } catch {
        this.logger.warn(
          `[GoLocal247] Selector not found: "${selector}" — trying next`,
        );
        continue;
      }

      const listings = await page.evaluate(
        (sel: string): { name: string; link: string }[] => {
          const seen = new Set<string>();
          return Array.from(document.querySelectorAll(sel))
            .map((anchor) => ({
              name: (anchor as HTMLAnchorElement).textContent?.trim() ?? '',
              link: (anchor as HTMLAnchorElement).href,
            }))
            .filter(({ name, link }) => {
              if (!name || seen.has(link)) return false;
              seen.add(link);
              return true;
            });
        },
        selector,
      );

      if (listings.length > 0) {
        this.logger.log(
          `[GoLocal247] Listings found using selector: "${selector}"`,
        );
        return listings.slice(0, MAX_LISTINGS);
      }
    }

    return [];
  }

  /**
   * Extracts structured business details from a GoLocal247 detail page.
   * Uses multiple selector fallbacks for each field to handle layout variations.
   *
   * @param page - Puppeteer Page loaded with a GoLocal247 business detail URL
   * @returns Raw extracted business name, address, and phone
   */
  private async extractBusinessDetails(
    page: Page,
  ): Promise<{ name: string; address: string; phone: string }> {
    return page.evaluate(() => {
      const name =
        document.querySelector('h1.yext-name, h1')?.textContent?.trim() ??
        'N/A';

      const street =
        document
          .querySelector('span.yext-address, span.address')
          ?.textContent?.trim() ?? '';
      const city =
        document.querySelector('span.yext-city')?.textContent?.trim() ?? '';
      const state =
        document.querySelector('span.yext-state')?.textContent?.trim() ?? '';
      const zip =
        document.querySelector('span.yext-postalcode')?.textContent?.trim() ??
        '';

      // Combine address parts, filtering out empty segments
      const address =
        [street, city, state, zip].filter(Boolean).join(', ') || 'N/A';

      // Prefer span text; fall back to tel: href value
      const phoneSpan = document
        .querySelector('span.yext-main-phone')
        ?.textContent?.trim();
      const phoneTel = document
        .querySelector<HTMLAnchorElement>('a[href^="tel:"]')
        ?.href.replace('tel:', '');
      const phone = phoneSpan || phoneTel || 'N/A';

      return { name, address, phone };
    });
  }

  /**
   * Launches a headless Puppeteer browser with flags that suppress
   * common automation signals detected by anti-bot systems.
   *
   * @returns A configured Puppeteer Browser instance
   */
  private async launchBrowser(): Promise<Browser> {
    return puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
      ],
    });
  }

  /**
   * Creates a new Puppeteer page with realistic browser headers,
   * viewport, and user-agent to reduce bot detection likelihood.
   *
   * @param browser - Active Puppeteer Browser instance
   * @returns Configured stealth Page instance
   */
  private async newStealthPage(browser: Browser): Promise<Page> {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    );
    await page.setViewport({ width: 1280, height: 800 });
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,' +
        'image/avif,image/webp,image/apng,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
    });

    return page;
  }

  /**
   * Constructs the GoLocal247 search URL from a business name and location.
   *
   * GoLocal247 URL pattern: /search/{City}%252C-{ST}/{business+name}
   * The double-encoding (%252C) is intentional — GoLocal247 expects it.
   *
   * @param name     - Business name (spaces replaced with "+")
   * @param location - Raw location string to extract city and state from
   * @returns Fully formed GoLocal247 search URL
   */
  private buildSearchUrl(name: string, location: string): string {
    const cityState = this.extractCityState(location);
    const [city, state] = cityState.split(',').map((s) => s.trim());

    // GoLocal247 double-encodes the comma: "," → "%2C" → "%252C"
    const locationSlug = `${encodeURIComponent(city)}%252C-${state}`;
    const nameSlug = name.trim().replace(/\s+/g, '+');

    return `https://www.golocal247.com/search/${locationSlug}/${nameSlug}`;
  }

  /**
   * Extracts "City, ST" from a free-form location string.
   * Matches the last city + 2-letter state code segment.
   *
   * @param location - Raw location string (e.g. "123 Main St, Airdrie, AB")
   * @returns Normalized "City, ST" string, or the original string if no match
   */
  private extractCityState(location: string): string {
    const match = location.match(/([A-Za-z\s]+),\s*([A-Z]{2})\s*$/);
    return match ? `${match[1].trim()}, ${match[2]}` : location.trim();
  }

  /**
   * Finds the best matching listing from search results using two strategies:
   * 1. Exact substring match — listing name contains the full query
   * 2. Word overlap score — listing with most query words matched wins
   *
   * @param listings - Array of name+link objects from search results
   * @param query    - Original business name to match against
   * @returns The best matching listing object
   */
  private findBestMatch(
    listings: { name: string; link: string }[],
    query: string,
  ): { name: string; link: string } {
    const q = query.toLowerCase();

    // Strategy 1: Direct substring match
    const exact = listings.find((l) => l.name.toLowerCase().includes(q));
    if (exact) return exact;

    // Strategy 2: Word overlap scoring
    const words = q.split(/\s+/);
    return listings.reduce<{ name: string; link: string; score: number }>(
      (best, listing) => {
        const score = words.filter((word) =>
          listing.name.toLowerCase().includes(word),
        ).length;
        return score > best.score ? { ...listing, score } : best;
      },
      { ...listings[0], score: 0 },
    );
  }
}
