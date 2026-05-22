import { Injectable, Logger } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { Browser, chromium, Page } from 'playwright';

/**
 * Service responsible for scraping location data from Google Maps
 * using a headless Chromium browser via Playwright.
 */
@Injectable()
export class GoogleMapsScraperService {
  private readonly logger = new Logger(GoogleMapsScraperService.name);

  /**
   * Scrapes Google Maps for location results based on a search query.
   *
   * @param query - The search term to look up on Google Maps (e.g. "restaurants in Mumbai")
   * @returns A promise that resolves to an array of LocationResponseDto objects
   */
  async scrapeGoogleMaps(query: string): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({ headless: true });

    try {
      return await this.performScraping(browser, query);
    } catch (error) {
      this.logger.error(
        `Scraping failed for query "${query}": ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    } finally {
      // Always close the browser — whether success or failure
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Opens a new browser page, navigates to Google Maps, and extracts results.
   *
   * @param browser - The Playwright Browser instance to use
   * @param query   - The search query string
   * @returns Parsed location results as LocationResponseDto array
   */
  private async performScraping(
    browser: Browser,
    query: string,
  ): Promise<LocationResponseDto[]> {
    const context = await browser.newContext();
    const page = await context.newPage();

    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    await this.handleConsentPopup(page);

    const hasResults = await this.waitForResults(page);
    if (!hasResults) return [];

    const scrapedItems = await this.extractPageData(page);

    return this.buildResponseDtos(scrapedItems);
  }

  /**
   * Attempts to dismiss the Google consent/cookie popup if it appears.
   * Silently ignores if the popup is not present.
   *
   * @param page - Active Playwright Page instance
   */
  private async handleConsentPopup(page: Page): Promise<void> {
    try {
      const consentButton = page.locator(
        'button:has-text("Accept all"), button:has-text("I agree")',
      );

      if (await consentButton.isVisible({ timeout: 1000 })) {
        await consentButton.click();
        this.logger.log('Consent popup dismissed successfully');
      }
    } catch {
      // Consent popup not present — safe to continue
    }
  }

  /**
   * Waits for Google Maps search results or a single place detail page to load.
   *
   * @param page - Active Playwright Page instance
   * @returns True if results loaded successfully, false if timeout or no results
   */
  private async waitForResults(page: Page): Promise<boolean> {
    try {
      await page.waitForSelector('div[role="article"], h1.DUwDvf', {
        timeout: 15000,
      });
      return true;
    } catch {
      this.logger.warn('No results found or page load timed out');
      return false;
    }
  }

  /**
   * Runs in-page evaluation to extract raw location data from the DOM.
   * Handles two cases:
   *  1. A single exact-match place detail page (h1.DUwDvf is present)
   *  2. A list of multiple search result articles
   *
   * @param page - Active Playwright Page instance
   * @returns Raw array of scraped location objects
   */
  private async extractPageData(page: Page): Promise<RawScrapedLocation[]> {
    return page.evaluate((): RawScrapedLocation[] => {
      // --- Case 1: Single place detail page ---
      const exactName = document.querySelector('h1.DUwDvf')?.textContent;
      if (exactName) {
        const address =
          document
            .querySelector('button[data-item-id="address"]')
            ?.textContent?.trim() ?? '—';

        const phone =
          document
            .querySelector('button[data-tooltip*="phone"]')
            ?.textContent?.trim() ?? '—';

        return [
          {
            name: exactName,
            address,
            phone,
            locationLink: window.location.href,
          },
        ];
      }

      // --- Case 2: Multiple search result articles ---
      const articles = Array.from(
        document.querySelectorAll('div[role="article"]'),
      );

      return articles.map((item) => {
        const addressCandidates = Array.from(
          item.querySelectorAll('.W4Efsd'),
        ).map((el) => el.textContent ?? '');

        // Pick the first candidate that looks like a real address
        const address =
          addressCandidates.find((d) => d.includes(',') || d.length > 10) ??
          '—';

        return {
          name: item.querySelector('.qBF1Pd')?.textContent ?? '—',
          address,
          phone: item.querySelector('.Us7ffb')?.textContent ?? '—',
          locationLink:
            (item.querySelector('a.hfpxzc') as HTMLAnchorElement)?.href ?? '',
        };
      });
    });
  }

  /**
   * Converts raw scraped items into typed LocationResponseDto objects.
   * Filters out placeholder entries where the name was not found.
   *
   * @param items - Raw location objects from page evaluation
   * @returns Array of validated and timestamped LocationResponseDto instances
   */
  private buildResponseDtos(
    items: RawScrapedLocation[],
  ): LocationResponseDto[] {
    const timestamp = new Date().toISOString();

    return items
      .filter((item) => item.name !== '—')
      .map((item) => ({
        name: item.name,
        address: item.address,
        phone: item.phone,
        source: 'Google Maps',
        timestamp,
        locationLink: item.locationLink ?? '',
      }));
  }
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** Raw shape of a scraped location before DTO transformation */
interface RawScrapedLocation {
  name: string;
  address: string;
  phone: string;
  locationLink: string;
}
