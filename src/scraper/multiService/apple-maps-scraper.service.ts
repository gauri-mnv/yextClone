/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable, Logger } from '@nestjs/common';
import { Browser, chromium, Page } from 'playwright';
import { LocationResponseDto } from '../dto/location-response.dto';

/** Base URL for Apple Maps with geo-coordinate parameters to seed search area */
const APPLE_MAPS_SEARCH_BASE =
  'https://maps.apple.com/search?center=51.269400%2C-113.994623&span=0.027455%2C0.019869';

@Injectable()
export class AppleMapsScraperService {
  private readonly logger = new Logger(AppleMapsScraperService.name);

  /**
   * Scrapes Apple Maps for a business matching the given name and location.
   *
   * @param name     - Business name to search for (e.g. "Swanavon Dental Clinic")
   * @param location - Comma-separated location string (e.g. "102-10104 97 Ave, Grande Prairie, AB")
   * @returns A promise resolving to matched LocationResponseDto entries
   */
  async scrapeAppleMaps(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled', // Helps prevent bot detection blocks on map render
      ],
    });

    try {
      return await this.performScraping(browser, name, location);
    } catch (error) {
      this.logger.error(
        `[AppleMaps] Global scraper error: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    } finally {
      await browser.close();
    }
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Drives the full browser automation step-by-step.
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
      viewport: { width: 1440, height: 900 },
    });

    const page = await context.newPage();

    this.logger.log(
      `[AppleMaps] Navigating to Base Search Area: ${APPLE_MAPS_SEARCH_BASE}`,
    );
    await page.goto(APPLE_MAPS_SEARCH_BASE, {
      waitUntil: 'networkidle',
      timeout: 45000,
    });

    // Combine name and a simplified location query string to avoid ambiguity
    const cityOrZip = this.extractCityOrZip(location);
    const searchString = `${name} ${cityOrZip}`;
    this.logger.log(`[AppleMaps] Typing search query: "${searchString}"`);

    // 1. Target the Map UI Search Bar using the exact ID from your DOM node: #mw-search-input
    const searchInputSelector =
      '#mw-search-input, input[type="search"], input[placeholder="Apple Maps"]';

    // Wait up to 30 seconds for the Apple Maps SPA architecture to safely mount the input element
    await page.waitForSelector(searchInputSelector, {
      state: 'visible',
      timeout: 30000,
    });

    // Focus, wipe out any residual default string data, and type your business string natively
    await page.click(searchInputSelector);
    await page.locator(searchInputSelector).fill('');
    await page.fill(searchInputSelector, searchString);

    // Fire the Enter key to launch the canvas search query lookup pipeline
    await page.keyboard.press('Enter');
    // 2. Wait for search panels or immediate details panel to populate
    await this.waitForPanelSync(page);

    // 3. Handle a List of Search Hits vs. An Immediate Direct Redirect
    // If the browser URL contains '/search', click the most relevant business card
    if (page.url().includes('/search')) {
      const hitCardSelector =
        'div[class*="SearchNearby"], div[class*="search-result"], .search-results-list a, div[id="axDetails"]';
      try {
        const primaryCard = page.locator(hitCardSelector).first();
        if (await primaryCard.isVisible()) {
          this.logger.log(
            '[AppleMaps] Result list loaded. Activating first matching profile panel.',
          );
          await primaryCard.click();
          // Allow routing state redirection to register completely
          await page
            .waitForURL(/.*\/place\?.*/, { timeout: 15000 })
            .catch(() => {});
        }
      } catch (err) {
        this.logger.warn(
          `[AppleMaps] Card selection routing step bypassed or timed out: ${err}`,
        );
      }
    }

    // Give the layout platter micro-buffer to hydrate tags
    await page.waitForTimeout(2500);

    const targetClean = this.normalizeForComparison(name);
    const results: LocationResponseDto[] = [];

    // 4. Scrape the active page DOM values
    const extracted = await this.extractBusinessDetails(page);
    const foundClean = this.normalizeForComparison(extracted.name);

    const isMatch =
      foundClean.includes(targetClean) || targetClean.includes(foundClean);

    if (isMatch && extracted.name !== '—') {
      this.logger.log(`[AppleMaps] Match confirmed: "${extracted.name}"`);
      results.push({
        name: extracted.name,
        address: extracted.address,
        phone: extracted.phone,
        // Sets company's raw external website if found, falls back gracefully to current maps profile link
        locationLink:
          extracted.website !== '—' ? extracted.website : page.url(),
        source: 'Apple Maps',
        timestamp: new Date().toISOString(),
      });
    } else {
      this.logger.warn(
        `[AppleMaps] Scraping finished without matches. Found target: "${extracted.name}"`,
      );
    }

    return results;
  }

  /**
   * Synchronizes browser runtime engine against client-rendered SPA containers.
   */
  private async waitForPanelSync(page: Page): Promise<void> {
    try {
      await page.waitForFunction(
        () => {
          const currentUrl = window.location.href;
          return (
            currentUrl.includes('/place?') ||
            !!document.querySelector('#axHeader') ||
            !!document.querySelector('.sc-platter-container')
          );
        },
        { timeout: 25000 },
      );
    } catch {
      this.logger.warn(
        '[AppleMaps] Synchronization timeout triggered while waiting for map state updates.',
      );
    }
  }

  /**
   * Custom parser executing directly inside page context using the explicit
   * class trees discovered in your inspection panel.
   */
  private async extractBusinessDetails(page: Page): Promise<RawBusinessDetail> {
    return page.evaluate((): RawBusinessDetail => {
      // 1. Business Title Name Block
      // Tree: <div id="axHeader"> -> <h1 class="sc-header-title">
      const name =
        document
          .querySelector('#axHeader h1.sc-header-title, #axHeader h1')
          ?.textContent?.trim() ?? '—';

      // 2. Direct Business Target Website (Blue highlighted row row from screenshot)
      // Tree: <section class="sc-platter-cell"> -> <a class="none" href="...">
      // Excludes tracking objects or nested redirects to keep pipeline outputs raw
      const websiteAnchor = document.querySelector(
        'section.sc-platter-cell a[href^="http"]:not([href*="maps.apple"])',
      );
      const website = (websiteAnchor as HTMLAnchorElement)?.href ?? '—';

      // 3. Phone Field
      // Tree: <section class="sc-platter-cell"> -> <a href="tel:...">
      const phoneAnchor = document.querySelector(
        'section.sc-platter-cell a[href^="tel:"]',
      );
      const phone =
        phoneAnchor?.textContent?.trim().replace(/\s+/g, ' ') ?? '—';
      // 4. Exact Address Assembly (Targeting your specific anchor class structure)
      // Matches: <a class="sc-address"> -> <div class="mw-dir-label">
      const addressContainer = document.querySelector('a.sc-address');
      let address = '—';

      if (addressContainer) {
        const addressLines = Array.from(
          addressContainer.querySelectorAll('.mw-dir-label'),
        )
          .map((el) => el.textContent?.trim())
          .filter((text) => text && text.length > 0);

        if (addressLines.length > 0) {
          // Joins strings seamlessly: "103-2100 Market St, Airdrie AB T4A 0R8, Canada"
          address = addressLines.join(', ').replace(/\s+/g, ' ');
        }
      }

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
  website: string;
}
