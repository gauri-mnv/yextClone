import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright-extra';
import type { Browser, Page } from 'playwright-core';
import { LocationResponseDto } from '../dto/location-response.dto';

/** Base URL for ProfileCanada dentist listings in Alberta */
const PROFILE_CANADA_SEARCH_BASE =
  'https://www.profilecanada.com/category.cfm?cat=8021_Dentists&provP=AB&city=';

/**
 * Service responsible for scraping business location data from ProfileCanada.com
 * using a headless Chromium browser via Playwright Extra.
 */
@Injectable()
export class ProfileCanadaScraperService {
  private readonly logger = new Logger(ProfileCanadaScraperService.name);

  /**
   * Scrapes ProfileCanada for a business matching the given name and location.
   *
   * @param name     - Business name to search for (e.g. "Airdrie Choice Dental")
   * @param location - Comma-separated location string (e.g. "123 Main St, Airdrie, AB")
   * @returns A promise resolving to a single matched LocationResponseDto, or empty array
   */
  async scrapeProfileCanada(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const cityName = this.extractCityName(location);

    if (!cityName) {
      this.logger.warn(
        `[ProfileCanada] Could not extract city from location: "${location}"`,
      );
      return [];
    }

    const browser = await chromium.launch({ headless: true });

    try {
      return await this.performScraping(browser, name, cityName);
    } catch (error) {
      this.logger.error(
        `[ProfileCanada] Scraper error: ${error instanceof Error ? error.message : String(error)}`,
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
   * build URL → find matching business link → extract detail page data.
   *
   * @param browser  - Active Playwright Browser instance
   * @param name     - Target business name to match against listing links
   * @param cityName - URL-formatted city name (spaces replaced with "+")
   * @returns Matched location result wrapped in an array, or empty array
   */
  private async performScraping(
    browser: Browser,
    name: string,
    cityName: string,
  ): Promise<LocationResponseDto[]> {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    // Step 1: Load the city-level listing page
    const searchUrl = `${PROFILE_CANADA_SEARCH_BASE}${cityName}`;
    this.logger.log(`[ProfileCanada] Searching: ${searchUrl}`);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 45000,
    });

    // Step 2: Find the detail page link whose text matches the target business name
    const detailLink = await this.findMatchingBusinessLink(page, name);

    if (!detailLink) {
      this.logger.log(
        `[ProfileCanada] No matching listing found for "${name}" in "${cityName}"`,
      );
      return [];
    }

    // Step 3: Navigate to the detail page and extract business information
    await page.goto(detailLink, { waitUntil: 'domcontentloaded' });
    const extracted = await this.extractBusinessDetails(page, detailLink);

    const result: LocationResponseDto = {
      ...extracted,
      source: 'ProfileCanada',
      timestamp: new Date().toISOString(),
    };

    this.logger.log(`[ProfileCanada] Match found: "${extracted.name}"`);
    return [result];
  }

  /**
   * Scans all business listing links on the search results page and returns
   * the href of the first link whose text content matches the target name.
   *
   * Matching is case-insensitive and also checks the parent element's text
   * to handle cases where the name is split across child nodes.
   *
   * @param page       - Playwright Page loaded with the city listing results
   * @param targetName - Business name to search for
   * @returns The matched detail page URL, or null if no match found
   */
  private async findMatchingBusinessLink(
    page: Page,
    targetName: string,
  ): Promise<string | null> {
    return page.evaluate((name: string): string | null => {
      const lowerName = name.toLowerCase();

      const matchedLink = Array.from(
        document.querySelectorAll('a[href*="companydetail.cfm"]'),
      ).find(
        (anchor) =>
          anchor.textContent?.toLowerCase().includes(lowerName) ||
          anchor.parentElement?.textContent?.toLowerCase().includes(lowerName),
      );

      return matchedLink ? (matchedLink as HTMLAnchorElement).href : null;
    }, targetName);
  }

  /**
   * Extracts structured business details from a ProfileCanada detail page.
   * Uses multiple selector fallbacks (class, id, microdata) to handle
   * varying page layouts.
   *
   * @param page        - Playwright Page loaded with the business detail URL
   * @param currentLink - The URL of the detail page, used as locationLink
   * @returns Raw extracted business data
   */
  private async extractBusinessDetails(
    page: Page,
    currentLink: string,
  ): Promise<RawBusinessDetail> {
    return page.evaluate((link: string): RawBusinessDetail => {
      /** Extracts the business name from the page heading or microdata */
      const getName = (): string =>
        document.querySelector('h1, [itemprop="name"]')?.textContent?.trim() ??
        '—';

      /** Extracts and normalizes the business address, collapsing extra whitespace */
      const getAddress = (): string => {
        const raw = document
          .querySelector('.address, #company_address, [itemprop="address"]')
          ?.textContent?.trim();
        return raw ? raw.replace(/\s+/g, ' ') : '—';
      };

      /** Extracts the primary phone number */
      const getPhone = (): string =>
        document
          .querySelector('.phone, .tel, [itemprop="telephone"]')
          ?.textContent?.trim() ?? '—';

      /**
       * Extracts the external website URL from any outbound link on the page,
       * explicitly excluding internal ProfileCanada links.
       */
      const getWebsite = (): string => {
        const anchor = document.querySelector<HTMLAnchorElement>(
          'a[href*="http"]:not([href*="profilecanada"])',
        );
        return anchor?.href ?? '—';
      };

      return {
        name: getName(),
        address: getAddress(),
        phone: getPhone(),
        website: getWebsite(),
        locationLink: link,
      };
    }, currentLink);
  }

  /**
   * Parses a comma-separated location string and extracts the city segment.
   * Expects the city to be the second-to-last part (e.g. "123 Street, Calgary, AB").
   * Replaces spaces with "+" for URL compatibility.
   *
   * @param location - Raw location string (e.g. "123 Main St, Airdrie, AB, Canada")
   * @returns URL-safe city name string, or empty string if parsing fails
   */
  private extractCityName(location: string): string {
    const parts = location.split(',');
    if (parts.length < 2) return '';

    return parts[parts.length - 2].trim().replace(/\s+/g, '+');
  }
}

// ---------------------------------------------------------------------------
// Internal Types
// ---------------------------------------------------------------------------

/** Shape of raw data extracted from a ProfileCanada business detail page */
interface RawBusinessDetail {
  name: string;
  address: string;
  phone: string;
  website: string;
  locationLink: string;
}
