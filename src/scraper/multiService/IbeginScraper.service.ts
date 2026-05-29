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
      headless: true, // Turn true for headless server deployments
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
      const context = await browser.createBrowserContext();
      const page = await context.newPage();

      // Optimize performance footprint by skipping graphic binary streaming assets
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        if (['image', 'font', 'media'].includes(req.resourceType()))
          req.abort();
        else req.continue();
      });

      const formattedQuery = encodeURIComponent(query.trim());
      const initialSearchUrl = `https://www.ibegin.com/search/?cx=partner-pub-5473472811677186%3A4418038166&cof=FORID%3A10&ie=UTF-8&q=${formattedQuery}&w=`;

      this.logger.log(
        `[iBegin] Initializing navigation matrix: ${initialSearchUrl}`,
      );

      await page.goto(initialSearchUrl, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });

      this.logger.log(
        `[iBegin] Waiting for asynchronous engine to inject results...`,
      );

      // Target both standard structural layout and Google CSE dynamic runtime frames
      const engineLoaded = await page
        .waitForSelector(
          '.business strong a, div.business, .gsc-webResult, .gsc-result, #main_content',
          { timeout: 15000 },
        )
        .then(() => true)
        .catch(() => false);

      if (!engineLoaded) {
        this.logger.warn(
          `[iBegin Warning] Dynamic frame injection timed out. No results found for: "${query}".`,
        );
        await browser.close();
        return [];
      }

      // Micro buffer to ensure asynchronous frames finished text mapping layout
      await new Promise((resolve) => setTimeout(resolve, 3000));

      // Clean business query and location tokens for verification tracking
      const targetTokenName = query.toLowerCase().replace(/[^a-z0-9]/g, '');
      const targetTokenLoc = location.toLowerCase().replace(/[^a-z0-9]/g, '');

      // 🔥 FIX: Bracket aur variable parsing logic perfectly structurally encapsulated
      const verifiedDetailsLandingPage = await page.evaluate(
        (nameToken: string, locToken: string): string | null => {
          const allAnchors = Array.from(
            document.querySelectorAll(
              '.business strong a, a[href*="/directory/"], .gsc-thumbnail-inside a.gs-title, a.gs-title',
            ),
          ) as HTMLAnchorElement[] | [];

          if (allAnchors.length === 0) return null;

          const distinctLinks = Array.from(
            new Set(allAnchors.map((a: HTMLAnchorElement) => a.href)),
          );

          // Phase 1: Name + Location combo check
          for (const linkUrl of distinctLinks) {
            const cleanUrl = linkUrl.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (cleanUrl.includes(nameToken) && cleanUrl.includes(locToken)) {
              return linkUrl;
            }
          }

          // Phase 2: Soft fallback name footprint check
          for (const linkUrl of distinctLinks) {
            const cleanUrl = linkUrl.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (
              cleanUrl.includes(nameToken) &&
              !linkUrl.includes('google.com') &&
              !linkUrl.includes('cse')
            ) {
              return linkUrl;
            }
          }

          return null;
        },
        targetTokenName,
        targetTokenLoc,
      ); // Passed correctly here!

      if (!verifiedDetailsLandingPage) {
        this.logger.warn(
          `[iBegin Engine Blocked] URL handshake failed for criteria context: "${query}". Skipping.`,
        );
        await browser.close();
        return [];
      }

      this.logger.log(
        `[iBegin Matrix Clear] Navigating to validated directory page: ${verifiedDetailsLandingPage}`,
      );

      // 2. Head directly to the filtered profile detail node page
      await page.goto(verifiedDetailsLandingPage, {
        waitUntil: 'networkidle2',
        timeout: 45000,
      });

      // Wait explicitly for the profile description data layer to mount safely
      await page.waitForSelector('dl.dl-horizontal, [class*="dl-horizontal"]', {
        timeout: 15000,
      });
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 3. Extract exact core business metrics based on explicit screenshot elements framework
      const extracted = await page.evaluate(
        (): {
          name: string;
          address: string;
          website: string;
          phone: string;
        } => {
          // Target Name from explicit microformat block
          const nameEl = document.querySelector('dd.name, .fn.org.name, h2');
          const name = nameEl?.textContent?.trim() || '—';

          // Target full address components chain securely
          const streetEl = document.querySelector(
            'dd.street-address, [class*="street-address"]',
          );
          const cityEl = document.querySelector(
            'dd.address-city, [class*="address-city"]',
          );
          const postalEl = document.querySelector(
            'dd.postal-code, [class*="postal-code"]',
          );

          let address = '—';
          if (streetEl) {
            const rawAddressText = `${streetEl.textContent?.trim() || ''}, ${cityEl?.textContent?.trim() || ''} ${postalEl?.textContent?.trim() || ''}`;
            address = rawAddressText.replace(/\s+/g, ' ').trim();
          }

          // Target Official Website URL link data cell matching: <dd class="url"><b>
          const websiteEl = document.querySelector('dd.url b, dd.url');
          let website = '—';
          if (websiteEl && websiteEl.textContent) {
            const parsedUrlText = websiteEl.textContent.trim();
            if (parsedUrlText.startsWith('http')) {
              website = parsedUrlText;
            }
          }

          // Target Telephone component referencing layout node: <abbr class="tel phone">
          const phoneEl = document.querySelector(
            'abbr.tel.phone, .telephone, dd abbr',
          );
          const phone = phoneEl?.textContent?.trim() || '—';

          return { name, address, website, phone };
        },
      );

      this.logger.log(
        `[iBegin Engine Success] Extracted -> Name: ${extracted.name}, Website: ${extracted.website}`,
      );

      const result: LocationResponseDto = {
        name: extracted.name,
        address: extracted.address,
        phone: extracted.phone,
        locationLink:
          extracted.website !== '—'
            ? extracted.website
            : verifiedDetailsLandingPage,
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
