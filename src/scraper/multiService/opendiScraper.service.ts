import { Injectable, Logger } from '@nestjs/common';
import { Browser, BrowserContext, chromium, Page } from 'playwright';
import { LocationResponseDto } from '../dto/location-response.dto';
import { getPincodeFromAddress } from '../utils/location-helper';

/**
 * Service responsible for scraping business location data from Opendi.ca
 * using a headless Chromium browser via Playwright.
 */
@Injectable()
export class OpendiScraperService {
  private readonly logger = new Logger(OpendiScraperService.name);

  /** Maximum number of detail page links to visit per search */
  private readonly MAX_LINKS_TO_VISIT = 5;

  /**
   * Scrapes Opendi.ca for a business matching the given name and location.
   *
   * @param name     - Business name to search for (e.g. "Airdrie Choice Dental")
   * @param location - Human-readable location used to resolve a postal/area code
   * @returns A promise resolving to matched LocationResponseDto entries (at most one match)
   */
  async scrapeOpendi(
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
        `[Opendi] Global scraper error: ${error instanceof Error ? error.message : String(error)}`,
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
   * resolves pincode → builds search URL → collects links → visits each detail page.
   *
   * @param browser  - Active Playwright Browser instance
   * @param name     - Target business name
   * @param location - Raw location string to resolve into a pincode/area code
   * @returns Matched location results
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

    // Use a temporary page solely for pincode resolution, then discard it
    const utilPage = await context.newPage();
    const pincode = await getPincodeFromAddress(utilPage, location);
    await utilPage.close();

    const searchUrl = this.buildSearchUrl(name, pincode);
    this.logger.log(`[Opendi] Searching: ${searchUrl}`);

    const searchPage = await context.newPage();
    await searchPage.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const detailLinks = await this.collectDetailLinks(searchPage);
    await searchPage.close();

    return this.visitDetailPages(context, detailLinks, name);
  }

  /**
   * Constructs the Opendi search URL from a business name and resolved pincode.
   *
   * @param name    - Business name (will be URI-encoded)
   * @param pincode - Resolved area/postal code (will be URI-encoded)
   * @returns Fully formed search URL string
   */
  private buildSearchUrl(name: string, pincode: string): string {
    return (
      `https://www.opendi.ca/search` +
      `?what=${encodeURIComponent(name)}` +
      `&where=${encodeURIComponent(pincode)}`
    );
  }

  /**
   * Extracts unique detail page URLs from the Opendi search results page.
   * Tries multiple CSS selectors to handle varying page layouts.
   * Excludes search, auth, and listing-creation pages.
   *
   * @param page - Playwright Page showing the search results
   * @returns Deduplicated array of detail page URLs (capped at MAX_LINKS_TO_VISIT)
   */
  private async collectDetailLinks(page: Page): Promise<string[]> {
    return page.evaluate((maxLinks: number) => {
      const selectors = [
        'a.details',
        'a[href*="/details/"]',
        '.search-result h3 a',
        'a[href^="https://www.opendi.ca/"]',
      ];

      const collected = new Set<string>();

      for (const selector of selectors) {
        document.querySelectorAll(selector).forEach((el) => {
          const href = (el as HTMLAnchorElement).href;

          // Exclude navigation/utility pages — only keep business detail links
          const isValidDetailLink =
            href &&
            !href.includes('/search?') &&
            !href.includes('create-a-listing');

          if (isValidDetailLink) collected.add(href);
        });
      }

      return [...collected].slice(0, maxLinks);
    }, this.MAX_LINKS_TO_VISIT);
  }

  /**
   * Iterates over detail page links and returns the first result whose
   * business name closely matches the target name.
   *
   * Matching is case-insensitive and strips non-alphanumeric characters
   * so that punctuation/spacing differences are ignored.
   *
   * @param context   - Playwright BrowserContext used to open new tabs
   * @param links     - Detail page URLs to visit
   * @param targetName - The business name we are looking for
   * @returns Array containing the first matched result, or empty if none found
   */
  private async visitDetailPages(
    context: BrowserContext,
    links: string[],
    targetName: string,
  ): Promise<LocationResponseDto[]> {
    const targetClean = this.normalizeForComparison(targetName);

    for (const link of links) {
      const detailPage = await context.newPage();

      try {
        await detailPage.goto(link, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        const extracted = await this.extractBusinessDetails(detailPage, link);
        const foundClean = this.normalizeForComparison(extracted.name);

        // Skip obviously invalid pages (privacy policy pages, empty results)
        if (foundClean.includes('privacypolicy') || foundClean === '—') {
          continue;
        }

        // Accept the result if either name contains the other
        const isMatch =
          foundClean.includes(targetClean) || targetClean.includes(foundClean);

        if (isMatch) {
          this.logger.log(
            `[Opendi] Match found: "${extracted.name}" at ${link}`,
          );
          return [
            {
              name: extracted.name,
              address: extracted.address,
              phone: extracted.phone,
              locationLink: link,
              source: 'Opendi',
              timestamp: new Date().toISOString(),
            },
          ];
        }
      } catch (error) {
        this.logger.warn(
          `[Opendi] Failed to scrape detail page ${link}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      } finally {
        // Always close the tab — even if an error was thrown
        await detailPage.close();
      }
    }

    this.logger.log(`[Opendi] No matching business found for "${targetName}"`);
    return [];
  }

  /**
   * Extracts business details (name, phone, address, website) from a single
   * Opendi detail page using in-browser DOM evaluation.
   *
   * @param page        - Playwright Page loaded with the business detail URL
   * @param currentLink - The URL of the page, used as fallback for locationLink
   * @returns Raw extracted business data
   */
  private async extractBusinessDetails(
    page: Page,
    currentLink: string,
  ): Promise<RawBusinessDetail> {
    return page.evaluate((link: string): RawBusinessDetail => {
      /**
       * Finds the <dd> element immediately following a <dt> whose text
       * contains the given term — used to extract labeled fields like
       * Address, Phone, etc.
       */
      const getDDByDT = (term: string): string | null => {
        const matchingDT = Array.from(document.querySelectorAll('dt')).find(
          (el) =>
            el.textContent?.trim().toLowerCase().includes(term.toLowerCase()),
        );
        return matchingDT?.nextElementSibling?.textContent?.trim() ?? null;
      };

      const name =
        document.querySelector('.name h2, h1')?.textContent?.trim() ?? '—';

      const addressLine = getDDByDT('Address') ?? '';
      const placeLine = getDDByDT('Place') ?? '';
      // Combine address and place, collapsing any extra whitespace
      const address =
        `${addressLine} ${placeLine}`.trim().replace(/\s+/g, ' ') || '—';

      const phone = getDDByDT('Landline') ?? getDDByDT('Phone') ?? '—';

      const website =
        document.querySelector('dd a[href^="http"]')?.getAttribute('href') ??
        link;

      return { name, phone, address, locationLink: website };
    }, currentLink);
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

/** Shape of raw data extracted from an Opendi business detail page */
interface RawBusinessDetail {
  name: string;
  phone: string;
  address: string;
  locationLink: string;
}
