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
   *
   * Returns null if a CAPTCHA is detected so the caller can retry.
   *
   * @param browser      - Active Playwright Browser instance
   * @param businessName - Target business name
   * @param location     - Location string for Yelp search
   * @param attempt      - Current attempt number (used for logging)
   * @returns Array of results, or null if blocked by CAPTCHA
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
      // You can filter or format the messages here
      const text = msg.text();
      if (text.startsWith('[Infobel]')) {
        this.logger.debug(`[Browser Context] `);
      } else {
        // Optional: Catch all other native browser logs if needed
        this.logger.verbose(`[Browser Window] `);
      }
    });
    // -----------------------------------------------------------------

    const searchUrl =
      `https://www.yelp.com/search` +
      `?find_desc=${encodeURIComponent(businessName)}` +
      `&find_loc=${encodeURIComponent(location)}`;

    this.logger.log(`[Yelp] Attempt ${attempt} — navigating to: ${searchUrl}`);

    await page.goto(searchUrl, { waitUntil: 'networkidle', timeout: 50000 });

    // Simulate human-like reading pause and scroll before interacting
    await this.delay(1500 + Math.random() * 2500);
    await this.humanScroll(page);
    await this.delay(800 + Math.random() * 1200);

    if (await this.isCaptchaPresent(page)) {
      return null; // Signal caller to retry with fresh browser/fingerprint
    }

    // Wait for result cards — non-fatal if absent (handled below)
    await page
      .waitForSelector('div[data-testid="serp-ia-card"], h3 a[href*="/biz/"]', {
        timeout: 15000,
      })
      .catch(() => null);

    const businessLinks = await this.collectBusinessLinks(page, businessName);

    console.log(`businessLinks`, businessLinks);

    if (businessLinks.length === 0) {
      this.logger.warn(`[Yelp] No business links found on attempt ${attempt}`);
      return [];
    }

    return this.visitDetailPages(page, businessLinks);
  }

  /**
   * Launches a headless Chromium browser with flags that suppress
   * common automation signals detected by anti-bot systems.
   *
   * @returns A configured Playwright Browser instance
   */
  private async launchBrowser(): Promise<Browser> {
    return chromiumExtra.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-site-isolation-trials',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
        '--hide-scrollbars',
        '--mute-audio',
        '--disable-web-security',
      ],
    }) as Promise<Browser>;
  }

  /**
   * Creates a new browser context with stealth settings:
   * randomized user-agent, realistic viewport, spoofed navigator properties,
   * and resource blocking to reduce fingerprint surface area.
   *
   * @param browser - Active Playwright Browser instance
   * @returns A fully configured stealth BrowserContext
   */
  private async newStealthContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent: USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      viewport: { width: 1366, height: 800 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Sec-Ch-Ua':
          '"Chromium";v="127", "Not(A:Brand";v="24", "Google Chrome";v="127"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
      },
      deviceScaleFactor: 1,
      hasTouch: false,
      isMobile: false,
      javaScriptEnabled: true,
    });

    // Block heavy assets to improve speed and reduce fingerprinting surface
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    // Inject anti-detection overrides into every page before scripts run
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });

      // Fake Chrome runtime object expected by fingerprint detectors
      (window as any).chrome = { runtime: {} };

      // Spoof permissions API to return real-looking notification state
      const originalQuery = window.navigator.permissions.query.bind(
        navigator.permissions,
      );
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({
              state: Notification.permission,
            } as PermissionStatus)
          : originalQuery(parameters);
    });

    return context;
  }

  // /**
  //  * Extracts unique Yelp business detail page URLs from the search results page.
  //  * Tries the primary card selector first, then falls back to any /biz/ link.
  //  * Strips query parameters to get canonical business URLs.
  //  *
  //  * NOTE: This runs in Node.js context (not browser evaluate) to avoid
  //  * the scoping issue where `this.logger` and `page` are inaccessible
  //  * inside page.evaluate().
  //  *
  //  * @param page - Playwright Page showing Yelp search results
  //  * @returns Deduplicated array of business detail URLs
  //  */
  // // private async collectBusinessLinks(page: Page): Promise<string[]> {

  // //   return page.evaluate((): string[] => {
  // //     const out = new Set<string>();

  // //     // Primary selector: structured result cards
  // //     document
  // //       .querySelectorAll('div[data-testid="serp-ia-card"] h3 a')
  // //       .forEach((anchor) => {
  // //         const href = (anchor as HTMLAnchorElement).href;
  // //         if (href.includes('/biz/')) {
  // //           out.add(href.split('?')[0]);
  // //         }
  // //       });

  // //     // Fallback: any /biz/ link on the page
  // //     if (out.size === 0) {
  // //       document.querySelectorAll('a[href*="/biz/"]').forEach((anchor) => {
  // //         const href = (anchor as HTMLAnchorElement).href;
  // //         if (!href.includes('adredir')) out.add(href.split('?')[0]);
  // //       });
  // //     }

  // //     return [...out];
  // //   });
  // // }

  /**
   * Extracts verified business profile links from Yelp search results.
   * Pulls both the business name and link from the structured cards, then
   * applies dynamic filtering to prevent capturing irrelevant sidebar recommendations.
   *
   * @param page  - Playwright Page context pointing to Yelp search results
   * @param query - The original target search term used for validation matching
   * @returns Deduplicated array of verified business profile URLs
   */
  private async collectBusinessLinks(
    page: Page,
    query: string,
  ): Promise<string[]> {
    // String matching parameters ke liye normalization utility function ka scope text prepare karein
    const targetClean = this.normalizeForComparison(query);

    return page.evaluate((target: string) => {
      const out = new Set<string>();

      // Internal helper function kyunki browser runtime context ke andar class methods available nahi hote
      const cleanString = (val: string) =>
        val.toLowerCase().replace(/[^a-z0-9]/g, '');

      // 1. Primary Extraction Path: Target the dedicated result card containers
      const cards = document.querySelectorAll(
        'div[data-testid="serp-ia-card"]',
      );

      cards.forEach((card) => {
        try {
          // Screenshot ke mutabik text element ko isolate karein aur name target karein
          const anchor = card.querySelector(
            'div[data-traffic-crawl-id="SearchResultBizName"] h3 a',
          ) as HTMLAnchorElement;

          if (anchor && anchor.href && anchor.href.includes('/biz/')) {
            const bizName = anchor.innerText || '—';
            const foundClean = cleanString(bizName);

            // Validation: Agar business ka naam query se match karta hai, tabhi link ko save karo
            if (foundClean.includes(target) || target.includes(foundClean)) {
              out.add(anchor.href.split('?')[0]);
            }
          }
        } catch {
          // Block boundary: Skip broken elements silently if any dynamic A/B layout mismatch happens
        }
      });

      // 2. Structural Fallback: Agar primary container selector fail ho jaye (Yelp layout update kare)
      if (out.size === 0) {
        document.querySelectorAll('a[href*="/biz/"]').forEach((anchor) => {
          try {
            const htmlAnchor = anchor as HTMLAnchorElement;
            if (!htmlAnchor.href.includes('adredir')) {
              const bizName = htmlAnchor.innerText || '—';
              const foundClean = cleanString(bizName);

              if (foundClean.includes(target) || target.includes(foundClean)) {
                out.add(htmlAnchor.href.split('?')[0]);
              }
            }
          } catch {
            // Keep loop moving forward
          }
        });
      }

      return [...out];
    }, targetClean); // Passing the sanitized target query directly into the browser context execution execution scope
  }

  /**
   * Normalizes strings for secure comparison metrics.
   */
  private normalizeForComparison(value: string): string {
    return value.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /**
   * Visits each business detail page link, checks for CAPTCHAs,
   * and extracts structured business information.
   * Skips individual links on CAPTCHA or error without stopping the loop.
   *
   * @param page  - Playwright Page instance (reused across detail navigations)
   * @param links - Business detail page URLs to visit
   * @returns Array of successfully extracted LocationResponseDto objects
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
          timeout: 25000,
        });
        await this.delay(800 + Math.random() * 1200);

        // Skip this listing if blocked — don't abort the entire loop
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
          `[Yelp] Failed to extract details for ${link}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return results;
  }

  /**
   * Extracts structured business details from a Yelp business detail page.
   * Phone is extracted via regex across candidate text elements since Yelp
   * does not expose a reliable tel: href on detail pages.
   *
   * @param page - Playwright Page loaded with a Yelp business detail URL
   * @returns Raw extracted business name, address, and phone
   */
  private async extractBusinessDetails(
    page: Page,
  ): Promise<Pick<LocationResponseDto, 'name' | 'address' | 'phone'>> {
    return page.evaluate(() => {
      const name =
        document
          .querySelector('h1, .company-name, [itemprop="name"]')
          ?.textContent?.trim() ?? '—';

      const address =
        document.querySelector('address')?.textContent?.trim() ?? '—';

      // Yelp does not reliably expose tel: links — scan text nodes with regex
      const phoneRegex = /\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/;
      let phone = '—';

      for (const el of Array.from(document.querySelectorAll('p, span, div'))) {
        const text = (el as HTMLElement).innerText ?? '';
        const match = text.match(phoneRegex);
        // Short text length ensures we pick the dedicated phone element, not an address block
        if (match && text.length < 50) {
          phone = match[0];
          break;
        }
      }

      return { name, address, phone };
    });
  }

  /**
   * Checks whether any known Yelp CAPTCHA or PerimeterX verification
   * element is present on the current page.
   * Checks both page HTML content and visible iframe elements.
   *
   * @param page - Active Playwright Page instance
   * @returns True if a CAPTCHA or block screen is detected
   */
  private async isCaptchaPresent(page: Page): Promise<boolean> {
    const html = (await page.content()).toLowerCase();

    const hasTextSignal =
      html.includes('px-captcha') ||
      html.includes('perimeterx') ||
      html.includes('please verify') ||
      html.includes('press & hold') ||
      html.includes('recaptcha');

    if (hasTextSignal) return true;

    // Also check for iframe-based reCAPTCHA widgets
    const recaptchaFrame = await page
      .$('iframe[title*="reCAPTCHA"], iframe[src*="recaptcha"]')
      .catch(() => null);

    return !!recaptchaFrame;
  }

  /**
   * Simulates human-like scrolling by incrementally scrolling the page
   * in small steps with random delays between each scroll movement.
   * Helps pass bot detection heuristics that monitor scroll behavior.
   *
   * @param page - Active Playwright Page instance to scroll
   */
  private async humanScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const distance = 100 + Math.floor(Math.random() * 200);
      const delayMs = 80 + Math.floor(Math.random() * 120);

      for (let i = 0; i < 6; i++) {
        window.scrollBy(0, distance);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    });
  }

  /**
   * Returns a promise that resolves after a fixed number of milliseconds.
   *
   * @param ms - Duration to wait in milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
