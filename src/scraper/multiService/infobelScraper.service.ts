/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable prettier/prettier */
/* eslint-disable @typescript-eslint/no-base-to-string */
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

/** Maximum number of search attempts before giving up on bot-detection retries */
const MAX_SEARCH_RETRIES = 3;

/** Delay in milliseconds to wait after hitting the abuse/block page before retrying */
const ABUSE_RETRY_DELAY_MS = 5000;

/** Pool of user-agent strings rotated randomly to reduce bot fingerprinting */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
];

/**
 * Service responsible for scraping business location data from Infobel Pro
 * using a stealth headless Chromium browser with retry logic to handle
 * bot-detection and abuse page redirects.
 */
@Injectable()
export class InfobelScraperService {
  private readonly logger = new Logger(InfobelScraperService.name);

  /**
   * Scrapes Infobel Pro for a business matching the given name and location.
   *
   * @param targetName - Business name to search for (e.g. "Airdrie Choice Dental")
   * @param location   - Comma-separated location string (e.g. "123 Main St, Airdrie, AB")
   * @returns A promise resolving to a single matched LocationResponseDto, or empty array
   */
  async scrapeInfobel(
    targetName: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-infobars',
        '--window-position=0,0',
        '--ignore-certificate-errors',
      ],
    });

    try {
      return await this.performScraping(browser, targetName, location);
    } catch (error) {
      this.logger.error(
        `[Infobel] Scraper error: ${error instanceof Error ? error.message : String(error)}`,
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
   * setup context → search with retries → find business URL → extract detail page.
   *
   * @param browser    - Active Playwright Browser instance
   * @param targetName - Business name to search and match
   * @param location   - Raw location string used to extract the city
   * @returns Matched location result wrapped in an array, or empty array
   */
  private async performScraping(
    browser: Browser,
    targetName: string,
    location: string,
  ): Promise<LocationResponseDto[]> {

    
    // Rotate user-agent randomly to reduce bot fingerprinting
    const randomUserAgent =
      USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

    const context = await browser.newContext({ userAgent: randomUserAgent });
    const page = await context.newPage();
    page.on('console', (msg) => {
      // You can filter or format the messages here
      const text = msg.text();
      if (text.startsWith('[Infobel]')) {
        this.logger.debug(`[Browser Context] ${text}`);
      } else {
        // Optional: Catch all other native browser logs if needed
         this.logger.verbose(`[Browser Window] ${text}`);
      }
    });
    // -----------------------------------------------------------------

    const city = this.extractCity(location);

    // Step 1: Attempt search with retry logic for bot-detection handling
    const searchSuccessful = await this.attemptSearchWithRetries(
      page,
      context,
      targetName,
      city,
    );

    if (!searchSuccessful) {
      this.logger.error(
        `[Infobel] All ${MAX_SEARCH_RETRIES} attempts failed — bot detection not bypassed`,
      );
      return [];
    }

    // Step 2: Wait for results table and find the matching business URL
    await this.waitForResultsTable(page);

    const businessUrl = await this.findMatchingBusinessUrl(page, targetName);

    if (!businessUrl) {
      this.logger.log(
        `[Infobel] No matching listing found for "${targetName}"`,
      );
      return [];
    }

    // Step 3: Navigate to the detail page and extract business information
    await page.goto(businessUrl, { waitUntil: 'networkidle' });
    const extracted = await this.extractBusinessDetails(page, businessUrl);

    this.logger.log(`[Infobel] Match found: "${extracted.name}"`);
    return [extracted];
  }

  /**
   * Attempts the Infobel search up to MAX_SEARCH_RETRIES times.
   * On each attempt it fills the search form and submits it.
   * If an abuse/block page is detected, cookies are cleared and
   * a delay is introduced before the next attempt to mimic human behavior.
   *
   * @param page       - Active Playwright Page instance
   * @param context    - Browser context (used to clear cookies on abuse detection)
   * @param targetName - Business name to type into the search input
   * @param city       - Resolved city name for logging purposes
   * @returns True if search completed successfully, false if all retries exhausted
   */
  private async attemptSearchWithRetries(
    page: Page,
    context: Awaited<ReturnType<Browser['newContext']>>,
    targetName: string,
    city: string,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= MAX_SEARCH_RETRIES; attempt++) {
      this.logger.log(
        `[Infobel] Attempt ${attempt}/${MAX_SEARCH_RETRIES}: Searching for "${targetName}" in "${city}"`,
      );

      await page.goto('https://search.infobelpro.com/', {
        waitUntil: 'networkidle',
      });

      // Random human-like delay before interacting with the page
      await this.randomDelay(1000, 2000);

      await page.waitForSelector('#inputName', { timeout: 30000 });
      await page.click('#inputName');

      // Type with keystroke delay to mimic human input speed
      await page.type('#inputName', targetName, { delay: 150 });

      // Simulate random mouse movement to avoid static interaction patterns
      await page.mouse.move(Math.random() * 400, Math.random() * 400);

      // Wait until the search button is enabled before clicking
      await page.waitForFunction(
        () => {
          const btn = document.querySelector('#searchBtn') as HTMLButtonElement;
          return btn && !btn.disabled;
        },
        { timeout: 15000 },
      );

      await page.click('#searchBtn', { force: true });

      // Wait for navigation after form submission; timeout is non-fatal
      await page
        .waitForNavigation({ waitUntil: 'networkidle' })
        .catch(() =>
          this.logger.warn(
            '[Infobel] Navigation timeout after search — checking current state',
          ),
        );

      // Abort attempt if Infobel has flagged this session as a bot
      if (page.url().includes('/Abuse')) {
        this.logger.warn(
          `[Infobel] Abuse page detected on attempt ${attempt} — clearing cookies and retrying`,
        );
        await context.clearCookies();
        await this.delay(ABUSE_RETRY_DELAY_MS);
        continue;
      }

      return true; // Search completed successfully
    }

    return false; // All retries exhausted
  }

  /**
   * Waits for the Infobel search results table to appear in the DOM.
   * Logs a warning if results are slow or absent — does not throw,
   * allowing the scraper to attempt URL extraction anyway.
   *
   * @param page - Playwright Page showing Infobel search results
   */
  private async waitForResultsTable(page: Page): Promise<void> {
    try {
      await page.waitForSelector('.orderanalysis-table__row', {
        timeout: 15000,
      });


    } catch {
      this.logger.warn(
        '[Infobel] Results table not found or took too long to load — proceeding anyway',
      );
    }
  }

  /**
   * Scans the Infobel results table for a row whose business name
   * closely matches the target name and returns its detail page URL.
   *
   * Matching strips leading numbering (e.g. "6. ") and all non-alphanumeric
   * characters for case-insensitive fuzzy comparison.
   *
   * @param page       - Playwright Page showing Infobel search results
   * @param targetName - Business name to match against table rows
   * @returns Detail page URL of the matched business, or null if not found
   */
  private async findMatchingBusinessUrl(
    page: Page,
    targetName: string,
  ): Promise<string | null> {
    return page.evaluate((name: string): string | null => {
      const targetClean = name.toLowerCase().replace(/[^a-z0-9]/g, '');

      const matchedRow = Array.from(
        document.querySelectorAll('.orderanalysis-table__row'),
      ).find((row) => {
        const rawName = row.querySelector('td a')?.textContent?.trim() ?? '';


      console.log(`[Infobel] table found :${rawName}`);

        const cleanName = rawName
          .toLowerCase()
          .replace(/^\d+\.\s*/, '') // Strip leading numbering e.g. "6. "
          .replace(/[^a-z0-9]/g, ''); // Keep only alphanumeric characters
 console.log(`[Infobel] cleanName :${cleanName }`);
        return (
          cleanName.includes(targetClean) || targetClean.includes(cleanName)
        );
      });

      const link = matchedRow?.querySelector<HTMLAnchorElement>('td a');
      return link?.href ?? null;
    }, targetName);
  }

  /**
   * Extracts structured business details from an Infobel business detail page.
   *
   * @param page      - Playwright Page loaded with the business detail URL
   * @param sourceUrl - The URL of the detail page, used as locationLink
   * @returns Fully formed LocationResponseDto with source and timestamp
   */
  private async extractBusinessDetails(
    page: Page,
    sourceUrl: string,
  ): Promise<LocationResponseDto> {
    return page.evaluate((link: string): LocationResponseDto => {
      const name = document.querySelector('.banner-results__header--one')?.textContent?.trim() ?? '—';

      const address =
        document
          .querySelector('.banner-results__content')
          ?.textContent?.trim() ?? '—';

      // Strip "Tel." label that Infobel prepends to the phone number display
      // const phone =
      //   document
      //     .querySelector('.detail-info__content .detail-info__content--value')
      //     ?.textContent?.replace('Tel.', '')
      //     .trim() ?? '—';

      const phone =
  Array.from(document.querySelectorAll('.detail-info__content'))
    .find((el) =>
      el
        .querySelector('.detail-info__content--header')
        ?.textContent?.includes('Phone number')
    )
    ?.querySelector('.detail-info__content--value')
    ?.textContent?.trim() ?? '—';

      // External website: first outbound link that is not an Infobel internal link
      // const website =
      //   document.querySelector<HTMLAnchorElement>(
      //     'a[href^="http"]:not([href*="infobel"])',
      //   )?.href ?? '—';
      console.log(`[Infobel] result name :${name }`);
      return {
        name,
        address,
        phone,
        locationLink: link,
        source: 'Infobel',
        timestamp: new Date().toISOString(),
      };
    }, sourceUrl);
  }

  /**
   * Extracts the city segment from a comma-separated location string.
   * Takes the second part if available, otherwise falls back to the first.
   *
   * @param location - Raw location string (e.g. "123 Main St, Airdrie, AB")
   * @returns Trimmed city name string
   */
  private extractCity(location: string): string {
    const parts = location.split(',').map((part) => part.trim());
    return parts.length >= 2 ? parts[1] : parts[0];
  }

  /**
   * Returns a promise that resolves after a fixed number of milliseconds.
   * Used for deliberate pauses (e.g. after abuse page detection).
   *
   * @param ms - Duration to wait in milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Returns a promise that resolves after a random delay within a given range.
   * Used to simulate human-like timing between page interactions.
   *
   * @param minMs - Minimum delay in milliseconds
   * @param maxMs - Maximum delay in milliseconds
   */
  private randomDelay(minMs: number, maxMs: number): Promise<void> {
    const duration = Math.random() * (maxMs - minMs) + minMs;
    return new Promise((resolve) => setTimeout(resolve, duration));
  }
}
