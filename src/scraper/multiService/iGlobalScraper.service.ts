import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright-extra';
import type { Browser, Page } from 'playwright-core';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { LocationResponseDto } from '../dto/location-response.dto';

/**
 * Register the Stealth plugin once at module load time so that all
 * Chromium instances launched by this service bypass basic bot detection.
 */
chromium.use(StealthPlugin());

/** Base URL for iGlobal Canada business search */
const IGLOBAL_SEARCH_BASE = 'https://www.iglobal.co/canada/search/';

/**
 * Service responsible for scraping business location data from iGlobal.co
 * using a stealth headless Chromium browser via Playwright Extra.
 */
@Injectable()
export class IGlobalScraperService {
  private readonly logger = new Logger(IGlobalScraperService.name);

  /**
   * Scrapes iGlobal.co for a business matching the given name.
   *
   * @param targetName - Business name to search for (e.g. "Airdrie Choice Dental")
   * @returns A promise resolving to a single matched LocationResponseDto, or empty array
   */
  async scrapeIGlobal(targetName: string): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({ headless: true });

    try {
      return await this.performScraping(browser, targetName);
    } catch (error) {
      this.logger.error(
        `[iGlobal] Scraper error: ${error instanceof Error ? error.message : String(error)}`,
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
   * search → find matching link → navigate detail page → extract data.
   *
   * @param browser    - Active Playwright Browser instance
   * @param targetName - Business name to search and match
   * @returns Matched location result wrapped in an array, or empty array
   */
  private async performScraping(
    browser: Browser,
    targetName: string,
  ): Promise<LocationResponseDto[]> {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Step 1: Load the iGlobal search results page
    const searchUrl = `${IGLOBAL_SEARCH_BASE}${encodeURIComponent(targetName)}`;
    this.logger.log(`[iGlobal] Searching: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Step 2: Find the detail page URL whose link text matches the target name
    const businessUrl = await this.findMatchingBusinessUrl(page, targetName);

    if (!businessUrl) {
      this.logger.log(
        `[iGlobal] No matching listing found for "${targetName}"`,
      );
      return [];
    }

    // Step 3: Navigate to the business detail page
    // Uses 'networkidle' to ensure dynamically loaded contact details are present
    await page.goto(businessUrl, {
      waitUntil: 'networkidle',
      timeout: 30000,
    });

    // Step 4: Extract structured business details from the detail page
    const extracted = await this.extractBusinessDetails(page, businessUrl);

    this.logger.log(`[iGlobal] Match found: "${extracted.name}"`);

    return [
      {
        ...extracted,
        source: 'iGlobal',
        timestamp: new Date().toISOString(),
      },
    ];
  }

  /**
   * Scans all anchor tags on the search results page and returns the href
   * of the first link whose text closely matches the target business name.
   *
   * Matching is case-insensitive and strips non-alphanumeric characters
   * so punctuation and spacing differences are ignored.
   * Only links containing "/canada/" in their href are considered valid results.
   *
   * @param page       - Playwright Page loaded with iGlobal search results
   * @param targetName - Business name to match against link text
   * @returns Matched business detail URL, or null if no match found
   */
  private async findMatchingBusinessUrl(
    page: Page,
    targetName: string,
  ): Promise<string | null> {
    return page.evaluate((name: string): string | null => {
      const targetClean = name.toLowerCase().replace(/[^a-z0-9]/g, '');

      const matchedAnchor = Array.from(document.querySelectorAll('a')).find(
        (anchor) => {
          const linkTextClean = (anchor.textContent?.trim() ?? '')
            .toLowerCase()
            .replace(/[^a-z0-9]/g, '');

          // Only accept links that fuzzy-match the name AND point to a Canadian listing
          return (
            linkTextClean.includes(targetClean) &&
            anchor.href.includes('/canada/')
          );
        },
      );

      return matchedAnchor?.href ?? null;
    }, targetName);
  }

  /**
   * Extracts structured business details from an iGlobal business detail page.
   *
   * @param page       - Playwright Page loaded with the business detail URL
   * @param sourceUrl  - The URL of the detail page, used as locationLink
   * @returns Raw extracted business data
   */
  private async extractBusinessDetails(
    page: Page,
    sourceUrl: string,
  ): Promise<RawBusinessDetail> {
    return page.evaluate((link: string): RawBusinessDetail => {
      const name =
        document
          .querySelector('h1.company-profile-name')
          ?.textContent?.trim() ?? '—';

      // Address is nested inside a location anchor's span element
      const address =
        document
          .querySelector('a.card-location span')
          ?.textContent?.trim()
          .replace(/\s+/g, ' ') ?? '—';

      // Phone extracted from tel: href links for reliability
      const phone =
        document.querySelector('a[href^="tel:"]')?.textContent?.trim() ?? '—';

      // External website: first outbound link that is not an iGlobal internal link
      const website =
        document.querySelector<HTMLAnchorElement>(
          'a[href^="http"]:not([href*="iglobal"])',
        )?.href ?? '—';

      return { name, address, phone, website, locationLink: link };
    }, sourceUrl);
  }
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** Shape of raw data extracted from an iGlobal business detail page */
interface RawBusinessDetail {
  name: string;
  address: string;
  phone: string;
  website: string;
  locationLink: string;
}
