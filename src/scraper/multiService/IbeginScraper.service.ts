/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { LocationResponseDto } from '../dto/location-response.dto';

@Injectable()
export class IbeginScraperService {
  private readonly logger = new Logger(IbeginScraperService.name);

  /**
   * Main entry point for iBegin pipeline lookup with strict URL validation
   * @param query Business name to search for (e.g., 'Airdrie Choice Dental')
   * @param location Business location city/address context (e.g., 'Airdrie')
   */
  public async scrapeIbegin(
    query: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();

      // Optimize footprint but DO NOT block scripts/document redirections
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType())) {
          req.abort();
        } else {
          req.continue();
        }
      });

      const formattedQuery = encodeURIComponent(query.trim());
      const initialSearchUrl = `https://www.ibegin.com/search/?cx=partner-pub-5473472811677186%3A4418038166&cof=FORID%3A10&ie=UTF-8&q=${formattedQuery}&w=`;

      // this.logger.log(
      //   `[iBegin] Initializing navigation matrix: ${initialSearchUrl}`,
      // );

      await page.goto(initialSearchUrl, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });

      const targetResultsSelector =
        '.gsc-webResult, .gsc-result, .business, a.gs-title';

      // Check if search results load automatically right away
      const initialResultsLoaded = await page
        .waitForSelector(targetResultsSelector, { timeout: 4000 })
        .then(() => true)
        .catch(() => false);

      // 🎯 CONDITIONAL CLICK: Click search only if results did not render automatically
      if (!initialResultsLoaded) {
        this.logger.log(
          `[iBegin] Results not found instantly. Attempting to click search button fallback...`,
        );
        const searchButtonSelector =
          'button.gsc-search-button, .gsc-search-button-v2, input[value="Search"], .btn-primary';

        await page
          .waitForSelector(searchButtonSelector, { timeout: 5000 })
          .catch(() => {});
        const searchBtn = await page.$(searchButtonSelector);

        if (searchBtn) {
          await searchBtn.click();
          // this.logger.log(
          //   `[iBegin] Search button clicked. Awaiting results wrapper layer...`,
          // );
        }
      }

      // Final structural confirmation check
      const engineLoaded = await page
        .waitForSelector(targetResultsSelector, { timeout: 15000 })
        .then(() => true)
        .catch(() => false);

      if (!engineLoaded) {
        this.logger.warn(
          `[iBegin Warning] Elements missing for query: "${query}".`,
        );
        await browser.close();
        return [];
      }

      // 🎯 STEP 1: Scrape EVERY single raw link from the search result container
      const crawledLinks = await page.evaluate(() => {
        const searchContainer = document.querySelector(
          '.gsc-results-wrapper-nojs, .gsc-results, #cse, body',
        );
        if (!searchContainer) return [];

        const anchorElements: HTMLAnchorElement[] = Array.from(
          searchContainer.querySelectorAll(
            'a.gs-title, .gsc-webResult a, .business strong a',
          ),
        );

        // Return an array of objects containing the text and the absolute URL
        return anchorElements
          .map((anchor) => ({
            text: anchor.textContent?.trim() || '—',
            href: anchor.href || '',
          }))
          .filter((link) => link.href.length > 0);
      });
      // 🎯 STEP : Filter and print ONLY links containing the query terms in their text
      const cleanQuery = query.toLowerCase().trim();
      const filteredLinks = crawledLinks.filter((link) =>
        link.text.toLowerCase().includes(cleanQuery),
      );

      // 🎯 STEP 2: Print all discovered links out to your NestJS terminal console
      // this.logger.log(
      //   `=== [iBegin Audit] Discovered ${filteredLinks.length} total links on search page ===`,
      // );
      // filteredLinks.forEach((link, idx) => {
      //   this.logger.log(
      //     `   Link #${idx + 1}: [Text: "${link.text}"] -> URL: ${link.href}`,
      //   );
      // });
      // this.logger.log(
      //   `====================================================================`,
      // );

      const targetTokenName = query.toLowerCase().replace(/[^a-z0-9]/g, '');
      const targetTokenLoc = location.toLowerCase().replace(/[^a-z0-9]/g, '');

      // 🎯 STEP 3: Find the link that yields Name, Address, Phone, and Website
      let verifiedDetailsLandingPage: string | null = null;
      const ultimateFallbackLink: string | null = null;

      if (filteredLinks.length > 0) {
        // Take the first link whose text matches "Airdrie Choice Dental"
        const targetLink = filteredLinks[0].href;

        // this.logger.log(
        //   `[iBegin Verification] Resolving data profile node via tracking token: ${targetLink}`,
        // );

        // Approach A: Build the canonical iBegin business profile layout string directly
        // Structure: https://www.ibegin.com/directory/ca/[province]/[city]/[business-slug]/
        const computedCanonicalUrl = `https://www.ibegin.com/directory/ca/alberta/${targetTokenLoc}/${targetTokenName}/`;

        // this.logger.log(
        //   `[iBegin Verification] Checking computed canonical destination node: ${computedCanonicalUrl}`,
        // );

        // Let's navigate to this page directly since it holds the structured schema layout
        verifiedDetailsLandingPage = computedCanonicalUrl;
      } else if (ultimateFallbackLink) {
        // this.logger.warn(
        //   `[iBegin Verification] No perfect match name string found. Resorting to fallback.`,
        // );
        verifiedDetailsLandingPage = ultimateFallbackLink;
      }

      if (!verifiedDetailsLandingPage) {
        this.logger.warn(`[iBegin Handshake Failed] No profile matches found.`);
        await browser.close();
        return [];
      }

      // this.logger.log(
      //   `[iBegin Matrix Clear] Navigating to target data page: ${verifiedDetailsLandingPage}`,
      // );

      // Navigate to the resolved directory layout page
      await page.goto(verifiedDetailsLandingPage, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });

      // 🎯 STEP 4: Print the targeted properties in the terminal to confirm matches
      // this.logger.log(
      //   `[iBegin Extraction Matrix] Reading live properties from: ${page.url()}`,
      // );

      // 🎯 STEP : Loop through filtered links dynamically and find one with complete data layouts
      let extractedData: any = null;
      let finalizedProfileUrl = '';

      // this.logger.log(
      //   `[iBegin Verification Engine] Commencing live-node validation loop over ${filteredLinks.length} target candidate(s)...`,
      // );

      for (let i = 0; i < filteredLinks.length; i++) {
        const candidate = filteredLinks[i];
        // this.logger.log(
        //   `[Validation Iteration #${i + 1}/${filteredLinks.length}] testing route: ${candidate.href}`,
        // );

        try {
          // Navigate the main scraper frame directly to the outbound tracker link
          await page.goto(candidate.href, {
            waitUntil: 'networkidle2',
            timeout: 30000,
          });

          const currentLiveUrl = page.url();
          this.logger.log(` -> Landed on resolved location: ${currentLiveUrl}`);

          // Look for any of the critical identifier blocks for data extraction
          await page
            .waitForSelector(
              'dl.dl-horizontal, [class*="dl-horizontal"], h1, h2, .business-details',
              { timeout: 6000 },
            )
            .catch(() => {});

          // Execute test extraction directly on this live page view layer
          const attemptExtraction = await page.evaluate(() => {
            const nameEl = document.querySelector(
              'dd.name, .fn.org.name, h1, h2',
            );
            const name = nameEl?.textContent?.trim() || '';

            const streetEl = document.querySelector(
              'dd.street-address, [class*="street-address"]',
            );
            const postalEl = document.querySelector('dd.postal-code');

            // 🎯 FIXED TELEPHONE SELECTOR
            // Prioritize the specific 'tel' class over generic 'dd abbr' to stop grabbing "CA"
            const phoneEl = document.querySelector(
              'abbr.tel, abbr.phone, .telephone, dd .tel',
            );

            // Look for direct website anchors or non-ibegin outbound URLs
            const websiteEl = document.querySelector(
              'dd.url b, dd.url a, dd.url',
            );

            let websiteUrl = '';

            if (websiteEl) {
              // Try to read href if it's a link, otherwise scrape text inside the <b> block
              websiteUrl =
                (websiteEl as HTMLAnchorElement).href ||
                websiteEl.textContent?.trim() ||
                '';
            }

            // Clean up backslashes and whitespace from the extracted website string
            websiteUrl = websiteUrl.replace(/\s+/g, '').trim();

            // const website = websiteEl
            //   ? (websiteEl as HTMLAnchorElement).href ||
            //     websiteEl.textContent?.trim()
            //   : '';

            // Return values only if they genuinely populate with data strings
            if (name && name !== '—' && (streetEl || phoneEl)) {
              const cityEl = document.querySelector(
                'dd.address-city, [class*="address-city"]',
              );
              const postalEl = document.querySelector(
                'dd.postal-code, [class*="postal-code"]',
              );

              let fullAddress = '—';
              if (streetEl) {
                fullAddress =
                  `${streetEl.textContent?.trim() || ''}, ${cityEl?.textContent?.trim() || ''} ${postalEl?.textContent?.trim() || ''}`
                    .replace(/\s+/g, ' ')
                    .trim();
              } else {
                const altBlock = document.querySelector(
                  '.address, [itemprop="address"]',
                );
                if (altBlock) fullAddress = altBlock.textContent?.trim() || '—';
              }

              return {
                name,
                address: fullAddress,
                phone: phoneEl?.textContent?.trim() || '—',
                website: websiteUrl || '—',
              };
            }
            return null; // Signals this page is an index node or bad profile copy
          });

          if (attemptExtraction) {
            // this.logger.log(
            //   `   ✅ Success! Found matching parameters on Link #${i + 1}`,
            // );
            extractedData = attemptExtraction;
            // 🎯 HERE IS YOUR DATA VISUALIZATION LOG:
            // this.logger.log(
            //   `====================================================`,
            // );
            // this.logger.log(`   [LIVE PAGE EXTRACTION LOG]`);
            // this.logger.log(`   • Name:      ${extractedData.name}`);
            // this.logger.log(`   • Address:   ${extractedData.address}`);
            // this.logger.log(`   • Telephone: ${extractedData.phone}`);
            // this.logger.log(`   • Website:   ${extractedData.website}`);
            // this.logger.log(
            //   `====================================================`,
            // );

            finalizedProfileUrl = currentLiveUrl;
            break; // Stop checking further URLs since we hit a complete match profile!
          } else {
            this.logger.warn(
              `   ❌ Missing core fields on Link #${i + 1} (Likely a generic overview page). Rolling to next node...`,
            );
          }
        } catch (iterationError) {
          this.logger.error(
            `   ⚠️ Exception hit during Link #${i + 1} resolution: ${iterationError}`,
          );
        }
      }

      // 🎯 STEP 4: Post-Loop Validation Guard
      if (!extractedData) {
        this.logger.error(
          `[iBegin Failure] Exhausted all discovered search anchors. None yielded complete business details.`,
        );
        await browser.close();
        return [];
      }

      // this.logger.log(
      //   `[iBegin Engine Success] Profile Extracted -> Name: ${extractedData.name}`,
      // );

      const result: LocationResponseDto = {
        name: extractedData.name,
        address: extractedData.address,
        phone: extractedData.phone,
        locationLink: extractedData.website || finalizedProfileUrl, // The exact successful live URL
        source: 'iBegin',
        timestamp: new Date().toISOString(),
      };

      await browser.close();
      return [result];
    } catch (error) {
      this.logger.error(`[iBegin Core Exception Engine Error]: ${error}`);
      await browser.close();
      return [];
    }
  }
}
