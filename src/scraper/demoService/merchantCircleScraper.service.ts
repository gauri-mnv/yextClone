/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
import { Injectable, Logger } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import puppeteerExtra from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, Page } from 'puppeteer';

// Register the Stealth plugin globally once at module load
puppeteerExtra.use(StealthPlugin());

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
 * Service responsible for scraping business location data from MerchantCircle
 * using a stealth browser with CAPTCHA detection, human-like interaction
 * simulation, and exponential backoff retries matching the Yelp structure.
 */
@Injectable()
export class MerchantCircleScraperService {
  private readonly logger = new Logger(MerchantCircleScraperService.name);

  /**
   * Scrapes MerchantCircle for businesses matching name and location.
   * Retries up to MAX_ATTEMPTS times with exponential backoff if blocked.
   */
  async scrapeMerchantCircle(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const browser = await this.launchBrowser();

      try {
        const results = await this.performScraping(
          browser,
          name,
          location,
          attempt,
        );

        // null signals a CAPTCHA block — retry with fresh fingerprint
        if (results === null) {
          this.logger.warn(
            `[MerchantCircle] CAPTCHA detected on attempt ${attempt}/${MAX_ATTEMPTS} — retrying`,
          );
          await this.delay(3000 * attempt + Math.random() * 2000);
          continue;
        }

        return results;
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);

        if (
          errorMessage.includes('closed') ||
          errorMessage.includes('Target page') ||
          errorMessage.includes('Timeout')
        ) {
          this.logger.error(
            `[MerchantCircle] Attempt ${attempt} failed: CAPTCHA block or anti-bot challenge encountered.`,
          );
        } else {
          this.logger.error(
            `[MerchantCircle] Attempt ${attempt} failed: ${errorMessage}`,
          );
        }

        if (attempt < MAX_ATTEMPTS) {
          await this.delay(2000 * attempt);
        }
      } finally {
        // Always release browser resource regardless of outcome
        await browser.close().catch(() => null);
      }
    }

    return [];
  }

  // ---------------------------------------------------------------------------
  // Private Helpers
  // ---------------------------------------------------------------------------

  /**
   * Orchestrates a single scrape attempt
   */
  private async performScraping(
    browser: Browser,
    name: string,
    location: string,
    attempt: number,
  ): Promise<LocationResponseDto[] | null> {
    const page = await browser.newPage();
    await this.applyStealthSettings(page);

    const searchUrl = this.buildSearchUrl(name, location);
    this.logger.log(
      `[MerchantCircle] Attempt ${attempt} — navigating to: ${searchUrl}`,
    );

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 40000,
    });

    // Simulate human behavior patterns
    await this.delay(1500 + Math.random() * 2500);
    await this.humanScroll(page);
    await this.delay(800 + Math.random() * 1200);

    if (await this.isCaptchaPresent(page)) {
      return null; // Signals caller to cycle browser fingerprint
    }

    // Soft-wait for structural cards without throwing hard timeout errors
    await page
      .waitForSelector('h3.company-item-title', { timeout: 15000 })
      .catch(() => null);

    const listings = await this.collectSearchListings(page);

    if (listings.length === 0) {
      this.logger.warn(
        `[MerchantCircle] No business links found on attempt ${attempt}`,
      );
      return [];
    }

    const bestMatch = this.findBestMatch(listings, name);
    this.logger.log(
      `[MerchantCircle] Best match identified: "${bestMatch.name}"`,
    );

    // Navigate to Detail Page
    await page.goto(bestMatch.link, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await this.delay(1000 + Math.random() * 1000);

    if (await this.isCaptchaPresent(page)) {
      this.logger.warn(
        `[MerchantCircle] CAPTCHA on detail page — aborting path.`,
      );
      return null;
    }

    await page
      .waitForSelector('h1.business-info-title', { timeout: 15000 })
      .catch(() => null);

    const details = await this.extractBusinessDetails(page);

    return [
      {
        name: details.name !== 'N/A' ? details.name : bestMatch.name,
        address: details.address,
        phone: details.phone !== 'N/A' ? details.phone : bestMatch.phone,
        source: 'MerchantCircle',
        locationLink: bestMatch.link,
        timestamp: new Date().toISOString(),
      },
    ];
  }

  /**
   * Launches browser with flags identical to Yelp's anti-fingerprint configuration
   */
  private async launchBrowser(): Promise<Browser> {
    return puppeteerExtra.launch({
      headless: true, // Running headless: false passes anti-bot parameters significantly better
      executablePath: puppeteerExtra.executablePath(),
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
    }) as unknown as Promise<Browser>;
  }

  /**
   * Configures stealth configurations dynamically matching Playwright context behaviors
   */
  private async applyStealthSettings(page: Page): Promise<void> {
    const userAgent =
      USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    await page.setUserAgent(userAgent);
    await page.setViewport({ width: 1366, height: 800 });

    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      Accept:
        'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Upgrade-Insecure-Requests': '1',
    });

    // Request interception optimization to drop redundant bulky layout assets
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        req.abort().catch(() => null);
      } else {
        req.continue().catch(() => null);
      }
    });
  }

  /**
   * Evaluates listings from the DOM safely
   */
  private async collectSearchListings(page: Page) {
    return page.evaluate(() => {
      const items = Array.from(document.querySelectorAll('div.company-item'));
      return items
        .map((item) => {
          const titleAnchor = item.querySelector<HTMLAnchorElement>(
            'h3.company-item-title a',
          );
          const addressAnchor = item.querySelector<HTMLAnchorElement>(
            'div.company-item-address a.directions',
          );
          const phoneAnchor = item.querySelector<HTMLAnchorElement>(
            'a.company-item-phone',
          );

          return {
            score: 0,
            name: titleAnchor?.textContent?.trim() ?? '',
            link: titleAnchor?.href ?? '',
            address: addressAnchor?.textContent?.trim() ?? '',
            phone:
              phoneAnchor?.textContent?.trim() ??
              phoneAnchor?.href?.replace('tel:', '') ??
              '',
          };
        })
        .filter((l) => l.name && l.link);
    });
  }

  /**
   * Evaluates final business details from the page cleanly
   */
  private async extractBusinessDetails(page: Page) {
    return page.evaluate(() => {
      const name =
        document.querySelector('h1.business-info-title')?.textContent?.trim() ??
        'N/A';
      const phone =
        document
          .querySelector('span[itemprop="telephone"]')
          ?.textContent?.trim() ?? 'N/A';

      const street =
        document
          .querySelector('span[itemprop="streetAddress"]')
          ?.textContent?.trim() ?? '';
      const city =
        document
          .querySelector('span[itemprop="addressLocality"]')
          ?.textContent?.trim()
          .replace(/,$/, '')
          .trim() ?? '';
      const state =
        document
          .querySelector('span[itemprop="addressRegion"]')
          ?.textContent?.trim() ?? '';
      const zip =
        document
          .querySelector('span[itemprop="postalCode"]')
          ?.textContent?.trim() ?? '';

      const address =
        [street, city, state, zip].filter(Boolean).join(', ') || 'N/A';
      return { name, phone, address };
    });
  }

  /**
   * Scans for PerimeterX, Cloudflare, reCAPTCHA or general anti-bot frames
   */
  private async isCaptchaPresent(page: Page): Promise<boolean> {
    const html = (await page.content()).toLowerCase();
    const hasTextSignal =
      html.includes('px-captcha') ||
      html.includes('perimeterx') ||
      html.includes('please verify') ||
      html.includes('press & hold') ||
      html.includes('cloudflare') ||
      html.includes('recaptcha');

    if (hasTextSignal) return true;

    const hasFrame = await page
      .$('iframe[title*="reCAPTCHA"], iframe[src*="recaptcha"]')
      .catch(() => null);
    return !!hasFrame;
  }

  /**
   * Human scroll emulation wrapper
   */
  private async humanScroll(page: Page): Promise<void> {
    await page.evaluate(async () => {
      const distance = 120 + Math.floor(Math.random() * 150);
      const delayMs = 90 + Math.floor(Math.random() * 100);
      for (let i = 0; i < 5; i++) {
        window.scrollBy(0, distance);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    });
  }

  private buildSearchUrl(name: string, location: string): string {
    const q = encodeURIComponent(name.trim()).replace(/%20/g, '+');
    const qn = encodeURIComponent(location.trim()).replace(/%20/g, '+');
    return `https://www.merchantcircle.com/search?q=${q}&qn=${qn}`;
  }

  private findBestMatch(
    listings: {
      score: number;
      name: string;
      link: string;
      address: string;
      phone: string;
    }[],
    query: string,
  ) {
    const q = query.toLowerCase();
    const exact = listings.find((l) => l.name.toLowerCase().includes(q));
    if (exact) return exact;

    const words = q.split(/\s+/);
    return listings.reduce(
      (best, l) => {
        const score = words.filter((w) =>
          l.name.toLowerCase().includes(w),
        ).length;
        return score > best.score ? { ...l, score } : best;
      },
      { ...listings[0], score: 0 },
    );
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
