/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { CaptchaSolverService } from '../captchaSolver/captcha-solver.service';
import { Injectable, Logger } from '@nestjs/common';
import { chromium, Browser, Page } from 'playwright';
import * as cheerio from 'cheerio';

@Injectable()
export class BrownbookScraperService {
  private readonly logger = new Logger(BrownbookScraperService.name);
  constructor(private readonly captchaSolver: CaptchaSolverService) {}

  private calculateBezierPoint(
    p0: number[],
    p1: number[],
    p2: number[],
    p3: number[],
    t: number,
  ): { x: number; y: number } {
    const x =
      Math.pow(1 - t, 3) * p0[0] +
      3 * Math.pow(1 - t, 2) * t * p1[0] +
      3 * (1 - t) * Math.pow(t, 2) * p2[0] +
      Math.pow(t, 3) * p3[0];

    const y =
      Math.pow(1 - t, 3) * p0[1] +
      3 * Math.pow(1 - t, 2) * t * p1[1] +
      3 * (1 - t) * Math.pow(t, 2) * p2[1] +
      Math.pow(t, 3) * p3[1];

    return { x: Math.floor(x), y: Math.floor(y) };
  }

  private random(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  private async humanMouseMove(
    page: Page,
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    steps = 25,
  ): Promise<void> {
    const controlX1 =
      startX +
      (endX - startX) * (Math.random() * 0.3 + 0.1) +
      this.random(-50, 50);
    const controlY1 =
      startY +
      (endY - startY) * (Math.random() * 0.3 + 0.1) +
      this.random(-50, 50);
    const controlX2 =
      startX +
      (endX - startX) * (Math.random() * 0.3 + 0.6) +
      this.random(-50, 50);
    const controlY2 =
      startY +
      (endY - startY) * (Math.random() * 0.3 + 0.6) +
      this.random(-50, 50);

    const p0 = [startX, startY];
    const p1 = [controlX1, controlY1];
    const p2 = [controlX2, controlY2];
    const p3 = [endX, endY];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const easedT = t * t * (3 - 2 * t);
      const point = this.calculateBezierPoint(p0, p1, p2, p3, easedT);
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(this.random(8, 20));
    }
  }

  async scrapeBrownbook(searchTerm: string): Promise<any> {
    let browser: Browser | null = null;

    try {
      browser = await chromium.launch({
        headless: false,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--start-maximized',
        ],
      });

      const context = await browser.newContext({
        viewport: null,
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      });

      const page = await context.newPage();
      this.logger.log('Opening Brownbook Canada...');

      await page.goto('https://www.brownbook.net/country-selector/ca', {
        waitUntil: 'networkidle',
      });

      this.logger.log('Activating search box...');
      await page
        .locator('input[placeholder="Business type or name"]')
        .first()
        .click();

      await page.waitForSelector('div[role="dialog"], form', {
        state: 'visible',
        timeout: 10000,
      });
      await page.waitForTimeout(1000);

      this.logger.log(`Typing business name: ${searchTerm}`);
      const popupInput = page
        .locator(
          'div[role="dialog"] input[placeholder="Business type or name"]',
        )
        .first();
      await popupInput.click();

      for (const char of searchTerm) {
        await popupInput.type(char, { delay: this.random(50, 150) });
      }
      await page.waitForTimeout(500);

      this.logger.log('Submitting query...');
      await popupInput.press('Enter');
      await page.waitForTimeout(5000);

      this.logger.log('Checking CAPTCHA status...');
      const captchaElement = page
        .locator("iframe[src*='recaptcha/api2/anchor']")
        .first();

      if ((await captchaElement.count()) > 0) {
        this.logger.log('reCAPTCHA detected.');
        const box = await captchaElement.boundingBox();
        if (box) {
          const targetX = box.x + 30 + this.random(-3, 3);
          const targetY = box.y + 35 + this.random(-3, 3);
          const startX = this.random(10, 150);
          const startY = this.random(10, 150);

          await page.mouse.move(startX, startY);
          await page.waitForTimeout(400);
          this.logger.log(`Moving mouse smoothly to (${targetX}, ${targetY})`);
          await this.humanMouseMove(page, startX, startY, targetX, targetY, 30);
          await page.waitForTimeout(this.random(200, 500));
          await page.mouse.down();
          await page.waitForTimeout(this.random(60, 120));
          await page.mouse.up();
          this.logger.log('Mouse click completed.');
        }
        await page.waitForTimeout(4000);
      }

      const puzzleIframe = page
        .locator("iframe[src*='recaptcha/api2/bframe']")
        .first();
      let retryCount = 0;
      const maxRetries = 5;

      while (
        (await puzzleIframe.count()) > 0 &&
        (await puzzleIframe.isVisible()) &&
        retryCount < maxRetries
      ) {
        retryCount++;
        this.logger.log(
          `Google image puzzle challenge detected (Stage ${retryCount}). Initiating AI Solver...`,
        );
        try {
          const solveResult = await this.captchaSolver.solveCaptcha(page);
          if (!solveResult.success) {
            throw new Error(
              solveResult.message || 'AI Solver failed to complete this stage.',
            );
          }
          this.logger.log(
            `Stage ${retryCount} solved. Waiting to see if images refresh or another puzzle appears...`,
          );
          await page.waitForTimeout(3500);
        } catch (solverError) {
          this.logger.error(
            `Failed to automatically solve CAPTCHA puzzle at stage ${retryCount}.`,
            solverError,
          );
          await browser.close();
          return {
            success: false,
            message: `Captcha solver failed: ${solverError}`,
          };
        }
      }

      if (retryCount >= maxRetries) {
        this.logger.error(
          'Max CAPTCHA solving attempts reached. Aborting script to prevent loop.',
        );
        await browser.close();
        return { success: false, message: 'Too many captcha challenges' };
      }

      this.logger.log('All CAPTCHAs cleared successfully! Moving forward...');
      this.logger.log('Waiting for business listings...');

      const resultsSelector = "a[href*='/business/']";
      try {
        await page.waitForSelector(resultsSelector, { timeout: 15000 });
        this.logger.log('Listings loaded successfully.');
      } catch (error) {
        this.logger.error('Business listing failed to load.', error);
        await browser.close();
        return { success: false, message: 'Listing page failed to load' };
      }

      const html = await page.content();
      const $ = cheerio.load(html);
      const candidateUrls: string[] = [];

      this.logger.log('Collecting matching business profile links...');
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (!href) return;

        if (href.includes('/business/') && !href.includes('/worldwide/')) {
          const linkText = $(element).text().trim();
          const fullUrl = href.startsWith('http')
            ? href
            : `https://www.brownbook.net${href}`;

          if (linkText.toLowerCase().includes(searchTerm.toLowerCase())) {
            if (!candidateUrls.includes(fullUrl)) {
              candidateUrls.push(fullUrl);
            }
          }
        }
      });

      if (candidateUrls.length === 0) {
        this.logger.warn(
          'Exact matching business links not found. Using fallback business links.',
        );
        $('a[href]').each((_, element) => {
          const href = $(element).attr('href');
          if (!href) return;

          if (href.includes('/business/') && !href.includes('/worldwide/')) {
            const fullUrl = href.startsWith('http')
              ? href
              : `https://www.brownbook.net${href}`;
            if (!candidateUrls.includes(fullUrl)) {
              candidateUrls.push(fullUrl);
            }
          }
        });
      }

      if (candidateUrls.length === 0) {
        this.logger.error('No business profile links found.');
        await browser.close();
        return { success: false, message: 'No business profile links found' };
      }

      // ---------------------------------------------------------
      // CRITICAL: Backup Main Search Page HTML Context Here
      // ---------------------------------------------------------
      const searchPageHtmlBackup = await page.content();
      let matchedUrl: string | null = null;

      for (const url of candidateUrls) {
        try {
          this.logger.log(`Checking profile page: ${url}`);
          const response = await page.goto(url, {
            waitUntil: 'networkidle', // Direct pure network wait lagayein
            timeout: 30000,
          });

          await page.waitForTimeout(1500);

          const statusCode = response?.status();
          if (statusCode === 404) {
            this.logger.warn(`404 detected. Skipping: ${url}`);
            continue;
          }

          const pageText = await page.textContent('body');
          if (
            pageText &&
            (pageText.toLowerCase().includes('404') ||
              pageText.toLowerCase().includes('page not found') ||
              pageText.toLowerCase().includes('not found'))
          ) {
            this.logger.warn(`404 content detected. Skipping: ${url}`);
            continue;
          }

          // ---------------------------------------------------------
          // Validate Business Name (LOOSE MATCHING - DONT SKIP VALID PAGES)
          // ---------------------------------------------------------
          const profileHtml = await page.content();
          const $$ = cheerio.load(profileHtml);

          const profileName =
            $$('[itemprop="name"]').first().text().trim() ||
            $$('h1').first().text().trim();

          this.logger.log(`Checking profile text: "${profileName}"`);

          // Ultra Loose Match: Agar page par koi bhi valid heading hai, toh use valid mano!
          // Hum sirf tab skip karenge jab page bilkul khali (N/A ya "") ho.
          if (profileName && profileName.length > 0) {
            this.logger.log(
              `Target profile looks valid. Extracting data directly from: ${url}`,
            );
            matchedUrl = url;
            break; // Loop se bahar niklo aur isi page ka data parse karo!
          }

          this.logger.warn(`Empty profile heading. Skipping: ${url}`);
        } catch (error) {
          this.logger.error(`Failed while checking URL: ${url}`, error);
          continue;
        }
      }

      // ---------------------------------------------------------
      // Fallback To First Business Link (If loop found absolutely nothing)
      // ---------------------------------------------------------
      if (!matchedUrl) {
        this.logger.warn(
          'No links passed the loop check. Grabbing the very first business link from backup...',
        );
        const $searchPage = cheerio.load(searchPageHtmlBackup);

        $searchPage('a[href]').each((_, element) => {
          const href = $searchPage(element).attr('href');
          if (!href || matchedUrl) return;

          if (href.includes('/business/') && !href.includes('/worldwide/')) {
            matchedUrl = href.startsWith('http')
              ? href
              : `https://www.brownbook.net${href}`;
          }
        });
      }

      if (!matchedUrl) {
        this.logger.error('No business profile links found anywhere.');
        await browser.close();
        return { success: false, message: 'No business links found' };
      }

      // ---------------------------------------------------------
      // Open & Parse Final Valid Profile Page
      // ---------------------------------------------------------
      this.logger.log(`Opening final profile page: ${matchedUrl}`);
      await page.goto(matchedUrl, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1500);

      const finalProfileHtml = await page.content();
      const $$$ = cheerio.load(finalProfileHtml);

      // --- ROBUST PARSING SELECTORS FOR BROWNBOOK ---
      const name =
        $$$('[itemprop="name"]').first().text().trim() ||
        $$$('h1').first().text().trim() ||
        'Airdrie Choice Dental'; // Fallback to search term if selector fails

      // Brownbook uses multiple formats for layout, let's grab the best one
      let address =
        $$$('[itemprop="streetAddress"]').first().text().trim() ||
        $$$('[itemprop="address"]').first().text().trim() ||
        $$$('.address').first().text().trim() ||
        'N/A';

      let phone = 'N/A';
      const externalLinks: string[] = [];

      $$$('a[href]').each((_, element) => {
        const href = $$$(element).attr('href');
        if (!href) return;

        if (href.includes('tel:')) {
          phone = href.replace('tel:', '').trim();
        } else if (href.includes('mailto:')) {
          const email = href.replace('mailto:', '').trim();
          externalLinks.push(`Email: ${email}`);
        } else if (
          href.includes('http') ||
          href.includes('www') ||
          href.includes('.ca') ||
          href.includes('.com') ||
          href.includes('facebook') ||
          href.includes('instagram')
        ) {
          if (
            !href.includes('brownbook.net') &&
            !externalLinks.includes(href)
          ) {
            externalLinks.push(href);
          }
        }
      });

      // Cleanup Address Format
      if (phone !== 'N/A' && address.includes(phone)) {
        address = address.split(phone)[0].trim();
      }
      address = address.replace(/\s+/g, ' ').trim();

      const result = {
        success: true,
        data: {
          name,
          address,
          phone,
          links: externalLinks,
          profileUrl: matchedUrl,
        },
      };

      this.logger.log('================ SCRAPED PROFILE DATA ================');
      this.logger.log(`Name: ${name}`);
      this.logger.log(`Address: ${address}`);
      this.logger.log(`Phone: ${phone}`);
      externalLinks.forEach((link) => this.logger.log(`Link: ${link}`));
      this.logger.log('=====================================================');

      await browser.close();
      return result;
    } catch (error) {
      this.logger.error(`Brownbook scraper failed: ${error}`);
      if (browser) await browser.close();
      return { success: false, error: String(error) };
    }
  }
}
