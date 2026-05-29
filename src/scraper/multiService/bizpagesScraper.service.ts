/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { LocationResponseDto } from '../dto/location-response.dto';

@Injectable()
export class BizpagesScraperService {
  private readonly logger = new Logger(BizpagesScraperService.name);

  /**
   * Main entry point for Bizpages scraper pipeline
   * @param query Business name to look up (e.g., 'Airdrie Choice Dental')
   * @param location Business location city/state context (e.g., 'Airdrie')
   */
  public async scrapeBizpages(
    query: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await puppeteer.launch({
      headless: false, // Turn true for production server execution
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();

      // Skip heavy binary assets to keep network bandwidth fast
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType()))
          req.abort();
        else req.continue();
      });

      // Target country directory base URL for matching target locations
      const rootDiscoveryUrl = 'https://bizpages.org/countries--CA--Canada';
      this.logger.log(
        `[Bizpages] Booting discovery base frame: ${rootDiscoveryUrl}`,
      );

      await page.goto(rootDiscoveryUrl, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });

      // 1. Locate search input element using the precise ID provided
      const searchInputSelector = '#mainsearch_input_id';
      await page.waitForSelector(searchInputSelector, { timeout: 15000 });

      this.logger.log(`[Bizpages] Focus and clear input element...`);
      await page.focus(searchInputSelector);

      // Clear existing default value if any safely
      await page.evaluate((selector) => {
        const input = document.querySelector(selector) as HTMLInputElement;
        if (input) input.value = '';
      }, searchInputSelector);

      this.logger.log(
        `[Bizpages] Typing query with human-like delay to trigger dynamic JS: "${query}"`,
      );
      // Simulating character typing strictly forces the page to fire oninput="drop_down_search(this.value);"
      await page.type(searchInputSelector, query.trim(), { delay: 120 });

      this.logger.log(
        `[Bizpages] Waiting for async dynamic dropdown list box to mount in DOM...`,
      );
      // Explicitly wait for the asynchronous dropdown links wrapper array to populate on screen
      const dropdownLoaded = await page
        .waitForSelector('a.dd_search_link, #dd_search_res_tab', {
          timeout: 15000,
        })
        .then(() => true)
        .catch(() => false);

      if (!dropdownLoaded) {
        this.logger.warn(
          `[Bizpages Blocked] Dynamic dropdown suggestion panel failed to render for: "${query}".`,
        );
        await browser.close();
        return [];
      }

      // Quick 1-second static delay to let the UI finish animating/rendering the listing text
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Tokens setup for script profile correlation validation
      const targetTokenName = query.toLowerCase().replace(/[^a-z0-9]/g, '');
      const targetTokenLoc = location.toLowerCase().replace(/[^a-z0-9]/g, '');

      this.logger.log(
        `[Bizpages] Scanning live dropdown results to locate matching node...`,
      );

      // 2. Identify the accurate dropdown link from the array and click it directly instead of pressing Enter
      const clickedSuccess = await page.evaluate(
        (nameToken: string, locToken: string): boolean => {
          // Gather all links inside the generated live dropdown grid container
          const dynamicDropdownLinks = Array.from(
            document.querySelectorAll('a.dd_search_link'),
          ) as HTMLAnchorElement[] | [];

          if (dynamicDropdownLinks.length === 0) return false;

          // Phase 1: Try strict match evaluation (Name + Location match inside list cell string/href)
          let targetElement = dynamicDropdownLinks.find((anchor) => {
            const normText =
              anchor.textContent?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
            const normHref = anchor.href
              .toLowerCase()
              .replace(/[^a-z0-9]/g, '');
            return (
              (normText.includes(nameToken) && normText.includes(locToken)) ||
              (normHref.includes(nameToken) && normHref.includes(locToken))
            );
          });

          // Phase 2: If strict matches fail, fallback to base business name lookup token
          if (!targetElement) {
            targetElement = dynamicDropdownLinks.find((anchor) => {
              const normText =
                anchor.textContent?.toLowerCase().replace(/[^a-z0-9]/g, '') ||
                '';
              const normHref = anchor.href
                .toLowerCase()
                .replace(/[^a-z0-9]/g, '');
              return (
                normText.includes(nameToken) || normHref.includes(nameToken)
              );
            });
          }

          // If a valid listing is targeted inside the suggestion array, dispatch click event instantly
          if (targetElement) {
            targetElement.click();
            return true;
          }

          // Fallback fallback: If alignment checks fail but elements are present, tap the first visible item
          if (dynamicDropdownLinks[0]) {
            dynamicDropdownLinks[0].click();
            return true;
          }

          return false;
        },
        targetTokenName,
        targetTokenLoc,
      );

      if (!clickedSuccess) {
        this.logger.warn(
          `[Bizpages Dropdown Failure] No valid suggestion link found in dropdown overlay array. Skipping.`,
        );
        await browser.close();
        return [];
      }

      this.logger.log(
        `[Bizpages Dropdown Triggered] Successfully clicked dropdown node item! Waiting for profile page navigation...`,
      );

      // Wait for navigation transition context to resolve onto the target business dashboard
      await page
        .waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 })
        .catch(() => {
          this.logger.log(
            '[Bizpages Info] Page routing stable. Proceeding to target data selectors layer.',
          );
        });

      // Save the validated landing page url to use it later as an absolute fallback tracking resource
      const verifiedLandingProfilePage = page.url();

      // Explicitly wait for profile header tracking container to load up
      await page.waitForSelector(
        'h1.profilename, [itemprop="streetAddress"], table.profiletable',
        { timeout: 15000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 4. Scrape exact business metrics mapped inside semantic properties layer
      const extractedMetrics = await page.evaluate(
        (): {
          name: string;
          address: string;
          phone: string;
          protectedWebHref: string | null;
        } => {
          // Target structural profile name title tag
          const nameNode = document.querySelector('h1.profilename, h1');
          const name = nameNode?.textContent?.trim() || '—';

          // Extract full address component blocks using clean microdata queries
          const streetNode = document.querySelector(
            '[itemprop="streetAddress"]',
          );
          const cityNode = document.querySelector('a[href*="/city--"]');
          const regionNode = document.querySelector('a[href*="/regional--"]');
          const countryNode = document.querySelector(
            '[itemprop="addressCountry"]',
          );

          let address = '—';
          if (streetNode || cityNode) {
            const fullRawAddress = `
            ${streetNode?.textContent?.trim() || ''}, 
            ${cityNode?.textContent?.trim() || ''} 
            ${regionNode?.textContent?.trim() || ''} 
            ${countryNode?.textContent?.trim() || ''}
          `;
            address = fullRawAddress
              .replace(/\s+/g, ' ')
              .replace(/, ,/g, ',')
              .trim()
              .replace(/^,|,$/g, '');
          }

          // 🔥 THE ULTIMATE EXACT-CELL PHONE EXTRACTION ENGINE
          let phone = '—';

          // Strategy A: Target strictly via the "Office Phone, Mobile, Fax" header container mapping
          const allHeaders = Array.from(
            document.querySelectorAll('h3.profilename, h3, h4, b'),
          );
          const phoneHeader = allHeaders.find((el) =>
            el.textContent?.toLowerCase().includes('office phone'),
          );

          if (phoneHeader) {
            // Find the immediate next table sibling containing the real phone numbers array matrix
            const targetPhoneTable =
              phoneHeader.nextElementSibling?.closest('table') ||
              phoneHeader.parentElement?.querySelector('table.noborder_tab');

            if (targetPhoneTable && targetPhoneTable.textContent) {
              const strictPhoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
              const match =
                targetPhoneTable.textContent.match(strictPhoneRegex);
              if (match && match[0]) {
                phone = match[0].trim();
              }
            }
          }

          // Strategy B: Paragraph Text Fallback - Scan descriptions for text like "You can call at 587-775-9911"
          if (phone === '—') {
            const descriptionBlocks = Array.from(
              document.querySelectorAll('p, div, td'),
            );
            const callTextRegex =
              /call\s+(?:at\s+)?((?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/i;

            for (const block of descriptionBlocks) {
              const match = block.textContent?.match(callTextRegex);
              if (match && match[1]) {
                phone = match[1].trim();
                break;
              }
            }
          }

          // Strategy C: Global Match Fallback - If everything fails, run regex on the entire document body safely
          if (phone === '—') {
            const globalPhoneRegex = /\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/;
            const foundMatches =
              document.body.innerText.match(globalPhoneRegex);
            if (foundMatches && foundMatches[0]) {
              phone = foundMatches[0].trim();
            }
          }

          // Locate "Website and pages" section link safely
          let protectedWebHref: string | null = null;
          const websiteHeader = allHeaders.find((el) =>
            el.textContent?.toLowerCase().includes('website and pages'),
          );

          // Grab the actual protected redirect anchor link
          const protectedAnchor = document.querySelector(
            'a[href*="cgi-bin/out.cgi"], a[href*="redirect"]',
          ) as HTMLAnchorElement;

          if (protectedAnchor) {
            protectedWebHref = protectedAnchor.href;
          } else if (websiteHeader) {
            let nextEl = websiteHeader.nextElementSibling;
            for (let i = 0; i < 3 && nextEl; i++) {
              const anchor =
                nextEl.tagName === 'A'
                  ? (nextEl as HTMLAnchorElement)
                  : nextEl.querySelector('a');
              if (anchor && anchor.href) {
                protectedWebHref = anchor.href;
                break;
              }
              nextEl = nextEl.nextElementSibling;
            }
          }

          return { name, address, phone, protectedWebHref };
        },
      );

      // --- PHASE 2: SOLVING DYNAMIC MATH CAPTCHA GATEWAY FOR REAL WEBSITE ---
      let resolvedOfficialWebsite = '—';

      if (
        extractedMetrics.protectedWebHref &&
        extractedMetrics.protectedWebHref.includes('bizpages.org')
      ) {
        this.logger.log(
          `[Bizpages Gateway] Protected redirect link found: ${extractedMetrics.protectedWebHref}. Navigating to clear Math Challenge...`,
        );

        try {
          // Open protection gateway page in the same page flow
          await page.goto(extractedMetrics.protectedWebHref, {
            waitUntil: 'networkidle2',
            timeout: 30000,
          });

          // Wait for the math question text block to render completely
          await page.waitForSelector('input[name="go"], input[type="text"]', {
            timeout: 10000,
          });

          // Parse out the math equation dynamically from body string (e.g., "1 + 2 =")
          const captchaSolution = await page.evaluate((): string | null => {
            const bodyText = document.body.innerText;
            // Matches expressions like: 1 + 2 = or 5 + 4 =
            const mathRegex = /(\d+)\s*\+\s*(\d+)\s*=/;
            const match = bodyText.match(mathRegex);

            if (match) {
              const num1 = parseInt(match[1], 10);
              const num2 = parseInt(match[2], 10);
              return (num1 + num2).toString();
            }
            return null;
          });

          if (captchaSolution) {
            this.logger.log(
              `[Bizpages Gateway] Math equation parsed successfully. Solution calculated: ${captchaSolution}`,
            );

            // Focus and input the result inside the text area field box next to GO
            const answerInputSelector = 'input[type="text"]';
            await page.focus(answerInputSelector);
            await page.type(answerInputSelector, captchaSolution);

            // Click the GO validation submit action button
            const goButtonSelector =
              'input[type="button"], input[value="GO"], input[name="go"]';
            await Promise.all([
              page.click(goButtonSelector),
              page
                .waitForNavigation({
                  waitUntil: 'networkidle2',
                  timeout: 20000,
                })
                .catch(() => {}),
            ]);

            // Real business official website is now cleanly resolved in the browser URL pool!
            const rawFinalUrl = page.url();
            if (
              rawFinalUrl &&
              !rawFinalUrl.includes('bizpages.org') &&
              rawFinalUrl.startsWith('http')
            ) {
              resolvedOfficialWebsite = rawFinalUrl;
              this.logger.log(
                `[Bizpages Gateway Clear] Verified destination URL fetched: ${resolvedOfficialWebsite}`,
              );
            }
          }
        } catch (gatewayErr) {
          const gatewayErrorMessage =
            gatewayErr instanceof Error ? gatewayErr : String(gatewayErr);
          this.logger.error(
            `[Bizpages Warning] Captcha redirection sequence failed or timed out: ${gatewayErrorMessage}`,
          );
        }
      }

      // 🔥 EXPLICIT FALLBACK SANITIZATION LAYER: Stops local routing loop leaks (localhost:3000/-)
      if (
        !resolvedOfficialWebsite ||
        resolvedOfficialWebsite === '—' ||
        resolvedOfficialWebsite.trim() === '' ||
        resolvedOfficialWebsite.endsWith('/-') ||
        resolvedOfficialWebsite === '/'
      ) {
        this.logger.warn(
          `[Pipeline Routing Alert] Real website domain lookup failed or corrupted. Securing landing trace URL context.`,
        );
        resolvedOfficialWebsite = verifiedLandingProfilePage;
      }

      // --- PHASE 3: DTO PAYLOAD PACKAGING ---
      const result: LocationResponseDto = {
        name: extractedMetrics.name,
        address: extractedMetrics.address,
        phone: extractedMetrics.phone,
        locationLink: resolvedOfficialWebsite,
        source: 'Bizpages',
        timestamp: new Date().toISOString(),
      };

      await browser.close();
      return [result];
    } catch (error) {
      this.logger.error(`[Bizpages Pipeline Core Exception Failure]: ${error}`);
      return [];
    }
  }
}
