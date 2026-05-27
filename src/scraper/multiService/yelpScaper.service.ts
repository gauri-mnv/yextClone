/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import { Injectable, Logger } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';

/**
 * Register the Stealth plugin once at module load time so that all
 * Chromium instances launched by this service bypass basic bot detection.
 */
chromiumExtra.use(StealthPlugin());

/** Maximum number of business detail page links to visit per search */
const MAX_DETAIL_LINKS = 5;

/** Maximum number of full scrape attempts before giving up */
const MAX_ATTEMPTS = 3;

/** Pool of realistic user-agent strings rotated per session */
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
];

/**
 * Service responsible for scraping business location data from Yelp
 * using a stealth headless Chromium browser with CAPTCHA detection,
 * human-like interaction simulation, and exponential backoff retries.
 */
@Injectable()
export class YelpScraperService {
  private readonly logger = new Logger(YelpScraperService.name);

  /**
   * Scrapes Yelp for businesses matching the given name and location.
   * Retries up to MAX_ATTEMPTS times with exponential backoff if blocked.
   *
   * @param businessName - Business name to search for (e.g. "Airdrie Choice Dental")
   * @param location     - Location string passed to Yelp search (e.g. "Airdrie, AB")
   * @returns A promise resolving to an array of matched LocationResponseDto objects
   */
  async scrapeYelp(
    businessName: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const browser = await this.launchBrowser();

      try {
        const results = await this.performScraping(
          browser,
          businessName,
          location,
          attempt,
        );

        // null signals a CAPTCHA block — retry with fresh fingerprint
        if (results === null) {
          this.logger.warn(
            `[Yelp] CAPTCHA detected on attempt ${attempt}/${MAX_ATTEMPTS} — retrying`,
          );
          await this.delay(3000 * attempt + Math.random() * 2000);
          continue;
        }

        return results;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        // Custom short logger for clean output when anti-bot triggers or crashes context
        if (
          errorMessage.includes('closed') ||
          errorMessage.includes('Target page') ||
          errorMessage.includes('Timeout')
        ) {
          this.logger.error(
            `[Yelp] Attempt ${attempt} failed: CAPTCHA block or anti-bot challenge encountered.`,
          );
        } else {
          this.logger.error(
            `[Yelp] Attempt ${attempt} failed: ${errorMessage}`,
          );
        }

        if (attempt < MAX_ATTEMPTS) {
          await this.delay(2000 * attempt);
        }
      } finally {
        // Always release the browser resource regardless of outcome
        await browser.close().catch(() => null);
      }
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Orchestrates a single scrape attempt:
   * navigate → human simulation → CAPTCHA check → collect links → visit detail pages.
   */
  private async performScraping(
    browser: Browser,
    businessName: string,
    location: string,
    attempt: number,
  ): Promise<LocationResponseDto[] | null> {
    const context = await this.newStealthContext(browser);
    const page = await context.newPage();

    page.on('console', (msg) => {
      const text = msg.text();
      if (text.startsWith('[Yelp]')) {
        this.logger.log(`[Browser Console] ${text}`);
      }
    });

    const searchUrl =
      `https://www.yelp.com/search` +
      `?find_desc=${encodeURIComponent(businessName)}` +
      `&find_loc=${encodeURIComponent(location)}`;

    this.logger.log(`[Yelp] Attempt ${attempt} — navigating to: ${searchUrl}`);

    // Emulate the double navigation style from Code 1 if it assists with cookie/session initializing
    await page
      .goto('https://www.yelp.com', {
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      })
      .catch(() => null);
    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 50000,
    });

    this.logger.log(`[Yelp] Final URL: ${page.url()}`);

    // Simulate human-like reading pause and scroll before interacting
    await this.delay(1500 + Math.random() * 2500);
    await this.humanScroll(page);
    await this.delay(800 + Math.random() * 1200);

    if (await this.isCaptchaPresent(page)) {
      return null;
    }

    // Wait for result cards safely
    await page
      .waitForSelector('div[data-testid="serp-ia-card"]', {
        timeout: 15000,
      })
      .catch(() => null);

    const businessLinks = await this.collectBusinessLinks(page);

    this.logger.log(
      `[Yelp] Found ${businessLinks.length} unique business links.`,
    );

    if (businessLinks.length === 0) {
      this.logger.warn(`[Yelp] No business links found on attempt ${attempt}`);
      return [];
    }

    return this.visitDetailPages(page, businessLinks);
  }

  /**
   * Launches a headless Chromium browser with anti-detection flags.
   */
  private async launchBrowser(): Promise<Browser> {
    return chromiumExtra.launch({
      headless: true, // Switched back to true as per Code 1
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--no-first-run',
        '--no-zygote',
      ],
    }) as Promise<Browser>;
  }

  /**
   * Creates a new browser context with stealth settings.
   */
  private async newStealthContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
      },
      deviceScaleFactor: 1,
      hasTouch: false,
    });

    // Inject anti-detection overrides into every page before scripts run
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    return context;
  }

  /**
   * Extracts verified business profile links from Yelp search results.
   * Reverted selectors and validation matching back to working Code 1 mechanics.
   */
  private async collectBusinessLinks(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const cards = Array.from(
        document.querySelectorAll('div[data-testid="serp-ia-card"]'),
      );
      const links: string[] = [];

      cards.forEach((card) => {
        const linkEl = card.querySelector('h3 a') as HTMLAnchorElement;
        if (
          linkEl &&
          linkEl.href &&
          linkEl.href.includes('/biz/') &&
          !linkEl.href.includes('adredir')
        ) {
          links.push(linkEl.href.split('?')[0]); // Clean up URLs
        }
      });

      // Fallback if structured cards failed
      if (links.length === 0) {
        document.querySelectorAll('a[href*="/biz/"]').forEach((anchor) => {
          const href = (anchor as HTMLAnchorElement).href;
          if (href && !href.includes('adredir')) {
            links.push(href.split('?')[0]);
          }
        });
      }

      return [...new Set(links)];
    });
  }

  /**
   * Visits each business detail page link and extracts structured business information.
   */
  private async visitDetailPages(
    page: Page,
    links: string[],
  ): Promise<LocationResponseDto[]> {
    const results: LocationResponseDto[] = [];

    for (const link of links.slice(0, MAX_DETAIL_LINKS)) {
      try {
        await page.goto(link, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });
        await this.delay(1000 + Math.random() * 1000);

        if (await this.isCaptchaPresent(page)) {
          this.logger.warn(`[Yelp] CAPTCHA on detail page — skipping: ${link}`);
          continue;
        }

        const details = await this.extractBusinessDetails(page);
        results.push({
          ...details,
          source: 'Yelp',
          locationLink: link,
          timestamp: new Date().toISOString(),
        });
      } catch (error) {
        this.logger.warn(
          `[Yelp] Failed to extract details for ${link} , error: ${error}`,
        );
      }
    }

    return results;
  }

  /**
   * Extracts structured business details matching Code 1 layout style fallback.
   */
  private async extractBusinessDetails(
    page: Page,
  ): Promise<Pick<LocationResponseDto, 'name' | 'address' | 'phone'>> {
    return page.evaluate(() => {
      const name = document.querySelector('h1')?.textContent?.trim() || 'N/A';
      const addressEl = document.querySelector('address');
      const address = addressEl?.textContent?.trim() || 'N/A';

      const phoneEl = Array.from(document.querySelectorAll('p')).find((p) =>
        /\(?([0-9]{3})\)?[-. ]?([0-9]{3})[-. ]?([0-9]{4})/.test(p.innerText),
      );
      const phone = phoneEl ? phoneEl.innerText.trim() : 'N/A';

      return { name, address, phone };
    });
  }

  /**
   * Checks whether any known Yelp CAPTCHA is present.
   */
  private async isCaptchaPresent(page: Page): Promise<boolean> {
    const html = (await page.content()).toLowerCase();
    const hasTextSignal =
      html.includes('px-captcha') ||
      html.includes('perimeterx') ||
      html.includes('recaptcha');

    if (hasTextSignal) return true;

    const recaptchaFrame = await page
      .$('iframe[title*="reCAPTCHA"]')
      .catch(() => null);
    return !!recaptchaFrame;
  }

  /**
   * Simulates human-like scrolling
   */
  private async humanScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const distance = 100 + Math.floor(Math.random() * 100);
      for (let i = 0; i < 3; i++) {
        window.scrollBy(0, distance);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
