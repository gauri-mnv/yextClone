/* eslint-disable @typescript-eslint/no-unused-vars */
import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

@Injectable()
export class KompassScraperService {
  private readonly logger = new Logger(KompassScraperService.name);

  public async scrapeKompass(name: string): Promise<void> {
    const browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--window-size=1366,768',
      ],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    const baseUrl = 'https://ca.kompass.com/';
    const targetSelector = 'input#search_header';

    try {
      this.logger.log(
        `[Navigation] Navigating to target landing page: ${baseUrl}`,
      );

      await page.goto(baseUrl, {
        waitUntil: 'networkidle2',
        timeout: 40000,
      });

      this.logger.log(
        `[Analysis] Checking for the presence of the search selector...`,
      );

      // Attempt to locate the target search field
      await page.waitForSelector(targetSelector, { timeout: 8000 });
      this.logger.log(
        `[STATUS: SUCCESS] Found selector "${targetSelector}". Page loaded normally.`,
      );
    } catch (error) {
      // Determine if a verification screen caused the failure
      const isIntercepted = await page
        .evaluate(() => {
          return (
            document.body.innerText.includes('Verification Required') ||
            !!document.querySelector('iframe[src*="captcha"]')
          );
        })
        .catch(() => false);

      if (isIntercepted) {
        this.logger.warn(
          `[STATUS: BLOCKED] Access was intercepted by a verification screen.`,
        );
      } else {
        this.logger.error(
          `[STATUS: FAILED] Selector "${targetSelector}" not found due to a standard timeout or structure change.`,
        );
      }
    } finally {
      this.logger.log(`[Clean Up] Closing browser session.`);
      await browser.close();
    }
  }
}
