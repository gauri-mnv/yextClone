/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { BrowserContext, Page } from 'puppeteer';
import { LocationResponseDto } from '../dto/location-response.dto';

@Injectable()
export class KompassScraperService {
  private readonly logger = new Logger(KompassScraperService.name);

  public async scrapeKompass(name: string): Promise<LocationResponseDto[]> {
    const browser = await puppeteer.launch({ headless: true });
    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // 1. Performance optimization: Block images/stylesheets to save bandwidth and scrape 3x faster
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'stylesheet', 'font', 'media'].includes(req.resourceType()))
        req.abort();
      else req.continue();
    });

    // const encodedQuery = encodeURIComponent(name);
    // const searchUrl = `https://ca.kompass.com/searchCompanies?text=${encodedQuery}&searchType=COMPANYNAME`;
    const baseUrl = 'https://ca.kompass.com/';
    try {
      this.logger.log(`[Kompass] Opening base landing page: ${baseUrl}`);
      // 1. Base URL par navigate karein aur DOM ready hone ka wait karein
      await page.goto(baseUrl, {
        waitUntil: 'networkidle2',
        timeout: 40000,
      });

      this.logger.log(`[Kompass] Typing company name: "${name}"`);
      // 2. Target input element ka wait karein jo aapki 'image_ba868b.jpg' me dikh raha hai
      await page.waitForSelector('input#search_header', { timeout: 7000 });

      // Input field ko clean karke name type karein
      await page.click('input#search_header', { clickCount: 3 });
      await page.type('input#search_header', name, { delay: 100 });

      this.logger.log(`[Kompass] Triggering search button click...`);
      // 3. Navigation trigger hone ka wait setup karein aur search button click karein
      const navigationPromise = page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: 30000,
      });
      await page.click('#search-icon, button.loupe');
      await navigationPromise;

      this.logger.log(
        `[Kompass] Successfully landed on results page. Current URL: ${page.url()}`,
      );

      // 4. Listing elements generate hone ka short buffer wait
      await page
        .waitForSelector('a[href*="/c/"]', { timeout: 10000 })
        .catch(() => {});
      const detailLinks = await page.evaluate((targetName) => {
        // Direct pure page par se wo <a> tag uthao jiska href me '/c/' ho aur title me company ka naam ho
        const selector = `a[href*="/c/"][title*="${targetName}"]`;
        const anchors = Array.from(document.querySelectorAll(selector));

        return anchors
          .map((el) => (el as HTMLAnchorElement).href)
          .filter((href, index, self) => href && self.indexOf(href) === index);
      }, name);
      this.logger.log(
        `[Kompass] Success! Detail links found: ${detailLinks.join(', ')}`,
      );
      if (!detailLinks || detailLinks.length === 0) {
        this.logger.warn(
          `[Kompass] No links found for query: ${name}. Moving to next.`,
        );
        return [];
      }

      this.logger.log(
        `[Kompass] Success! Discovered ${detailLinks.length} target records to process`,
      );
      return await this.visitDetailPages(context, detailLinks, name);
    } catch (error) {
      this.logger.error(`[Kompass Engine Failure]: ${error}`);
      return [];
    } finally {
      await page.close();
    }
  }
  private async visitDetailPages(
    context: BrowserContext,
    links: string[],
    targetName: string,
  ): Promise<LocationResponseDto[]> {
    const targetClean = this.normalizeForComparison(targetName);
    const results: LocationResponseDto[] = [];

    // Process only the top 3 highest-match links to save execution time and avoid rate-limiting
    const limitedLinks = links.slice(0, 3);

    for (const link of limitedLinks) {
      const detailPage = await context.newPage();
      try {
        // Reuse network interceptor on subpages
        await detailPage.setRequestInterception(true);
        detailPage.on('request', (req) => {
          if (['image', 'stylesheet', 'font'].includes(req.resourceType()))
            req.abort();
          else req.continue();
        });

        await detailPage.goto(link, {
          waitUntil: 'domcontentloaded',
          timeout: 20000,
        });

        // 3. Smart Waiting: Dynamic check instead of static waitForTimeout()
        await detailPage
          .waitForSelector('.companyCol, [itemprop="streetAddress"]', {
            timeout: 5000,
          })
          .catch(() => {});

        const extracted = await this.extractBusinessDetails(detailPage);
        const foundClean = this.normalizeForComparison(extracted.name);

        // Fuzzy matching logic to pass minor typo variants safely
        const isMatch =
          foundClean.includes(targetClean) || targetClean.includes(foundClean);
        this.logger.log(
          `[Kompass Parsing] Got: "${extracted.name}" | Validated Match: ${isMatch}`,
        );

        if (isMatch) {
          results.push({
            name: extracted.name,
            address: extracted.address,
            phone: extracted.phone,
            locationLink:
              extracted.website && extracted.website !== '—'
                ? extracted.website
                : link,
            source: 'Kompass',
            timestamp: new Date().toISOString(),
          });
        }
      } catch (error) {
        this.logger.warn(
          `[Kompass Profile Skip] Error parsing ${link}: ${error instanceof Error ? error.message : String}`,
        );
      } finally {
        await detailPage.close();
      }
    }

    return results;
  }

  private async extractBusinessDetails(page: Page): Promise<{
    name: string;
    address: string;
    phone: string;
    website: string;
  }> {
    return page.evaluate(() => {
      // 1. Company Name Header Extraction
      // Target h1 tag directly inside the primary profile block context
      const nameEl = document.querySelector('.companyCol h1, h1');
      const name =
        nameEl?.textContent?.replace(/Location\s*-\s*/i, '').trim() ?? '—';

      // 2. Structured Address Mapping (Screenshot ke DOM Tree ke mutabik)
      // Hum direct elements ke hierarchy spans ko query kar rahe hain
      const streetEl = document.querySelector(
        '.blockAddressPrim span:nth-child(1)',
      );
      const localityEl = document.querySelector('[itemprop="addressLocality"]');
      const postalEl = document.querySelector('[itemprop="postalCode"]');
      const countryEl = document.querySelector('[itemprop="addressCountry"]');

      // Cleaning values safely
      const street = streetEl?.textContent?.trim() || '';
      const locality = localityEl?.textContent?.trim() || '';
      const postal = postalEl?.textContent?.trim() || '';
      const country = countryEl?.textContent?.trim() || '';

      const addressParts = [street, locality, postal, country].filter(Boolean);
      const address = addressParts.length
        ? addressParts.join(', ').replace(/\s+/g, ' ')
        : '—';

      // 3. Hidden Contact Key Fetch
      const phoneInput = document.querySelector(
        'input[id^="freePhone-contactCompanyForCompany"]',
      ) as HTMLInputElement;
      const phone = phoneInput?.value?.trim() || '—';

      // 4. Clean Target Corporate URL Anchor Check
      const websiteAnchor = document.querySelector(
        '#webSite_presentation_0',
      ) as HTMLAnchorElement;
      const website = websiteAnchor?.href?.trim() || '—';

      return { name, address, phone, website };
    });
  }
  private normalizeForComparison(text: string): string {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .trim();
  }
}
