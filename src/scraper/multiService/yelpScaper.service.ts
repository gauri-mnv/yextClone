/* eslint-disable @typescript-eslint/unbound-method */
/* eslint-disable @typescript-eslint/ban-ts-comment */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable, Logger } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium as chromiumExtra } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import type { Browser, BrowserContext, Page } from 'playwright';

chromiumExtra.use(StealthPlugin());

@Injectable()
export class YelpScraperService {
  private readonly logger = new Logger(YelpScraperService.name);

  // Realistic User Agents pool — har request pe rotate karenge
  private readonly userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  ];

  private pickUA(): string {
    return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
  }

  private sleep(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }

  private async humanScroll(page: Page) {
    // Random human-like scroll, helps in passing bot heuristics
    await page.evaluate(async () => {
      const distance = 100 + Math.floor(Math.random() * 200);
      const delay = 80 + Math.floor(Math.random() * 120);
      for (let i = 0; i < 6; i++) {
        window.scrollBy(0, distance);
        await new Promise((r) => setTimeout(r, delay));
      }
    });
  }

  private async isCaptchaPresent(page: Page): Promise<boolean> {
    // Yelp ka captcha multiple forms mein aata hai - sab check karo
    const html = (await page.content()).toLowerCase();
    if (
      html.includes('px-captcha') ||
      html.includes('perimeterx') ||
      html.includes('please verify') ||
      html.includes('press & hold') ||
      html.includes('recaptcha')
    ) {
      return true;
    }
    // iframe based recaptcha
    const recaptchaFrame = await page
      .$('iframe[title*="reCAPTCHA"], iframe[src*="recaptcha"]')
      .catch(() => null);
    return !!recaptchaFrame;
  }

  private async launchBrowser(): Promise<Browser> {
    // Headless 'new' mode + flags jo automation flags hide karte hain
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

  private async newStealthContext(browser: Browser): Promise<BrowserContext> {
    const context = await browser.newContext({
      userAgent: this.pickUA(),
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

    // Heavy assets block karo — speed + less fingerprinting surface
    await context.route('**/*', (route) => {
      const type = route.request().resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(type)) {
        return route.abort();
      }
      return route.continue();
    });

    // Extra anti-detection script har page pe inject
    await context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
      });
      // chrome runtime fake
      // @ts-ignore
      window.chrome = { runtime: {} };
      // permissions fake
      const originalQuery = window.navigator.permissions.query;
      // @ts-ignore
      window.navigator.permissions.query = (parameters: any) =>
        parameters.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission } as any)
          : originalQuery(parameters);
    });

    return context;
  }
  private async checkAndLogStatus(page: Page, step: string) {
    const url = page.url();
    const title = await page.title();
    const isCaptcha = await page
      .isVisible(
        'div#px-captcha, div.px-captcha-container, iframe[src*="perimeterx"]',
      )
      .catch(() => false);

    this.logger.log(
      `[Step: ${step}] URL: ${url} | Title: ${title} | CAPTCHA Visible: ${isCaptcha}`,
    );

    if (isCaptcha) {
      this.logger.error(
        `🚨 BLOCKED: PerimeterX Verification screen detected at ${step}.`,
      );
      const audioBtn = await page.$('button.alan-button'); // Common selector for PX audio
      if (audioBtn) {
        this.logger.log('Audio verification option found.');
      } else {
        return;
      }
    }
  }

  async scrapeYelp(
    businessName: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const MAX_ATTEMPTS = 1;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      let browser: Browser | null = null;
      try {
        this.logger.log(`Starting attempt ${attempt}...`);
        browser = await this.launchBrowser();
        const context = await this.newStealthContext(browser);
        const page = await context.newPage();

        const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(
          businessName,
        )}&find_loc=${encodeURIComponent(location)}`;
        await page.goto(searchUrl, {
          waitUntil: 'networkidle',
          timeout: 50000,
        });
        this.logger.log(`Navigating to: ${searchUrl}`);
        // Random human delay
        await this.sleep(1500 + Math.random() * 2500);
        await this.humanScroll(page);
        await this.sleep(800 + Math.random() * 1200);

        await this.checkAndLogStatus(page, 'Initial Load');

        // Check if we are stuck on the verification page

        if (await this.isCaptchaPresent(page)) {
          this.logger.warn(
            `CAPTCHA detected on attempt ${attempt}/${MAX_ATTEMPTS}. Retrying with fresh fingerprint...`,
          );
          await this.sleep(5000);
          await browser.close();
          browser = null;
          // Exponential backoff
          await this.sleep(3000 * attempt + Math.random() * 2000);
          continue;
        }

        // Wait for results card
        await page
          .waitForSelector(
            'div[data-testid="serp-ia-card"], h3 a[href*="/biz/"]',
            {
              timeout: 15000,
            },
          )
          .catch(() => null);

        const businessLinks: string[] = await page.evaluate(async () => {
          this.logger.log(`Page Title: ${await page.title()}`);
          try {
            await page.waitForSelector('div[data-testid="serp-ia-card"]', {
              timeout: 15000,
            });
          } catch (e) {
            this.logger.error(
              'Failed to find business cards. Saving screenshot for debug.',
            );
            await page.screenshot({ path: `error-attempt-${attempt}.png` });

            // Log the first 500 characters of HTML to see if we are still blocked
            const body = await page.evaluate(() =>
              document.body.innerText.substring(0, 500),
            );
            this.logger.debug(`Page snippet: ${body}`);

            throw e; // Rethrow to trigger attempt loop
          }
          const out = new Set<string>();
          document
            .querySelectorAll('div[data-testid="serp-ia-card"] h3 a')
            .forEach((a) => {
              const href = (a as HTMLAnchorElement).href;
              if (href.includes('/biz/') && !href.includes('adredir')) {
                out.add(href.split('?')[0]);
              }
            });
          // Fallback selector
          if (out.size === 0) {
            document.querySelectorAll('a[href*="/biz/"]').forEach((a) => {
              const href = (a as HTMLAnchorElement).href;
              if (!href.includes('adredir')) out.add(href.split('?')[0]);
            });
          }
          return [...out];
        });

        if (businessLinks.length === 0) {
          this.logger.warn(`No results found on attempt ${attempt}`);
          await browser.close();
          browser = null;
          if (attempt < MAX_ATTEMPTS) {
            await this.sleep(2000 * attempt);
            continue;
          }
          return [];
        }

        const finalResults: LocationResponseDto[] = [];

        for (const link of businessLinks.slice(0, 5)) {
          try {
            await page.goto(link, {
              waitUntil: 'domcontentloaded',
              timeout: 25000,
            });
            await this.sleep(800 + Math.random() * 1200);

            // Detail page pe captcha aaya to skip
            if (await this.isCaptchaPresent(page)) {
              this.logger.warn(`CAPTCHA on detail page, skipping: ${link}`);
              continue;
            }

            const details = await page.evaluate(() => {
              const name =
                document.querySelector('h1')?.textContent?.trim() || '—';
              const address =
                document.querySelector('address')?.textContent?.trim() || '—';

              const phoneRegex =
                /\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})/;
              let phone = '—';
              const candidates = Array.from(
                document.querySelectorAll('p, span, div'),
              );
              for (const el of candidates) {
                const text = (el as HTMLElement).innerText || '';
                const match = text.match(phoneRegex);
                if (match && text.length < 50) {
                  phone = match[0];
                  break;
                }
              }
              return { name, address, phone };
            });

            finalResults.push({
              ...details,
              source: 'Yelp',
              locationLink: link,
              timestamp: new Date().toISOString(),
              // foundAt: new Date().toISOString(),
            });
          } catch (e) {
            this.logger.warn(`Failed to fetch details for ${link}: ${e}`);
            // Don't break — keep collecting whatever you can
            continue;
          }
        }

        this.logger.log('Success! Page loaded without instant block.');

        await browser.close();
        return finalResults;
      } catch (err) {
        this.logger.error(`Attempt ${attempt} failed: ${err}`);
        if (browser) {
          await browser.close().catch(() => null);
        }
        if (attempt < MAX_ATTEMPTS) {
          await this.sleep(2000 * attempt);
          continue;
        }
      }
    }
    return [];
  }
}
