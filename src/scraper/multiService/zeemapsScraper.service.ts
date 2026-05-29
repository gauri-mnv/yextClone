/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable, Logger } from '@nestjs/common';
import puppeteer from 'puppeteer';
import { LocationResponseDto } from '../dto/location-response.dto';

@Injectable()
export class ZeemapsScraperService {
  private readonly logger = new Logger(ZeemapsScraperService.name);

  /**
   * Main Entry point for Zeemaps pipeline lookup
   * @param query Business name to search for (e.g., 'Airdrie Choice Dental')
   */
  public async scrapeZeemaps(query: string): Promise<LocationResponseDto[]> {
    const browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    const context = await browser.createBrowserContext();
    const page = await context.newPage();

    // Block non-essential tracking vectors for optimization
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
      else req.continue();
    });

    // Format the search query to construct the initial lookup node
    const formattedQuery = encodeURIComponent(query.trim());
    const initialSearchUrl = `https://www.zeemaps.com/find.jsp?q=${formattedQuery}`;

    try {
      this.logger.log(
        `[Zeemaps] Launching query string tracker: ${initialSearchUrl}`,
      );

      await page.goto(initialSearchUrl, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });

      // 1. Wait for result anchors list matrix to mount in DOM
      await page.waitForSelector('#main_content ul li a', { timeout: 15000 });

      // Extract the absolute map hyperlink from the top search listing match element
      const targetMapLink = await page.evaluate((): string | null => {
        // 🔥 FIX: Cast the querySelector directly so TypeScript knows it's an Anchor element
        const standardAnchor = document.querySelector(
          '#main_content .col-md-12 ul li a, #main_content ul li a',
        ) as HTMLAnchorElement;

        return standardAnchor ? standardAnchor.href : null;
      });
      if (!targetMapLink) {
        this.logger.warn(
          `[Zeemaps] Extraction yielded 0 map paths for query entity: "${query}"`,
        );
        await browser.close();
        return [];
      }

      this.logger.log(
        `[Zeemaps] Found matching landing endpoint: ${targetMapLink}`,
      );

      // 2. Head directly over to the actual isolated Map view node page
      await page.goto(targetMapLink, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });

      // Wait explicitly for marker coordinate overlays to safely deploy info window containers
      this.logger.log(`[Zeemaps] Accessing dynamic infowindow layer...`);
      try {
        // 🔥 FIX 1: Map ke upar location pins dhoondhne ke liye multi-layer selector framework
        const markerSelector =
          'img[src*="marker"], .gm-style-moc, canvas, [title="Airdrie Choice Dental"], div[role="button"]';
        await page.waitForSelector(markerSelector, { timeout: 15000 });

        // Hum un unique attributes/markers ko target karenge jo maps click handlers ko dispatch karte hain
        await page.evaluate((businessName) => {
          // Method A: Title attribute se element dhoondho (Aapke tooltip box text ke matching)
          const explicitMarker =
            document.querySelector(`[title="${businessName}"]`) ||
            document.querySelector('img[src*="marker"]') ||
            document.querySelector('.gm-style img');

          if (explicitMarker instanceof HTMLElement) {
            explicitMarker.click();
            console.log(
              'Successfully clicked location marker via DOM dispatch!',
            );
            return true;
          }
          return false;
        }, query);

        // Safe delay buffer taaki click process hone par popup smooth render ho sake
        await new Promise((resolve) => setTimeout(resolve, 3000));
      } catch (clickError) {
        this.logger.warn(
          `[Zeemaps] Automatic pin interaction struggled: ${clickError}. Attempting structural parsing fallback.`,
        );
      }

      // 🔥 FIX 2: Click hone ke baad ab wait karein infowindow element container ke mount hone ka
      this.logger.log(`[Zeemaps] Accessing dynamic infowindow layer...`);
      await page.waitForSelector(
        '.infowindow, [class*="style-iw-"], .gm-style-iw',
        { timeout: 15000 },
      );

      // 3. Parse fields directly from the active infowindow markup frame layers matching screenshots
      const extracted = await page.evaluate(() => {
        console.log('--- Inside Zeemaps Dynamic Infowindow Parsing Node ---');

        // Dynamic classes fallback framework matching your inspected structures
        const titleEl = document.querySelector(
          '.infowindow .title, [class*="style-iw-"] .title, .gm-style-iw .title, [class*="-header"] [class*="-title"]',
        );
        const name = titleEl?.textContent?.trim() || '—';

        const addressEl = document.querySelector(
          '.infowindow .address, [class*="style-iw-"] .address, .gm-style-iw .address',
        );
        const address =
          addressEl?.textContent?.replace(/\s+/g, ' ').trim() || '—';

        const websiteAnchor = document.querySelector(
          '.markersubtitle a[href^="http"], .markersubtitle a',
        ) as HTMLAnchorElement;
        const website = websiteAnchor ? websiteAnchor.href.trim() : '—';

        let phone = '—';
        const phoneAnchor = document.querySelector(
          'a[href^="tel:"]',
        ) as HTMLAnchorElement;

        if (phoneAnchor) {
          phone = phoneAnchor.textContent?.trim() || '—';
        } else {
          const fieldRows = Array.from(
            document.querySelectorAll(
              '.fields .field-row, [class*="field-row"], [class*="-value"]',
            ),
          );
          fieldRows.forEach((row) => {
            const rowText = row.textContent || '';
            if (
              rowText.toLowerCase().includes('phone') ||
              rowText.includes('(')
            ) {
              const matchedDigits = rowText.match(
                /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
              );
              if (matchedDigits) phone = matchedDigits[0].trim();
            }
          });
        }

        return { name, address, website, phone };
      });

      this.logger.log(
        `[Zeemaps] Successfully extracted metrics -> Name: ${extracted.name}, Phone: ${extracted.phone}`,
      );

      const result: LocationResponseDto = {
        name: extracted.name,
        address: extracted.address,
        phone: extracted.phone,
        locationLink:
          extracted.website !== '—' ? extracted.website : targetMapLink,
        source: 'Zeemaps',
        timestamp: new Date().toISOString(),
      };

      await browser.close();
      return [result];
    } catch (error) {
      this.logger.error(`[Zeemaps Core Exception Engine]: ${error || error}`);
      await browser.close();
      return [];
    }
  }
}
