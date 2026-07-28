/* eslint-disable @typescript-eslint/restrict-template-expressions */
/* eslint-disable @typescript-eslint/no-floating-promises */
import { Injectable, Logger } from '@nestjs/common';
import puppeteer, { Page } from 'puppeteer';
import { LocationResponseDto } from '../dto/location-response.dto';

const DENTAL_CATEGORIES = [
  'Dental Clinic',
  'Dental Clinic, Hospital',
  'Dental Implants Periodontist',
  'Dental Services',
  'Dentist',
  'Dentists',
  'Denture Care Center',
] as const;

type DentalCategory = (typeof DENTAL_CATEGORIES)[number];

interface FormSearchFilters {
  businessName: string;
  category: DentalCategory;
  city?: string;
  province?: string;
}

@Injectable()
export class EnrollBusinessScraperService {
  private readonly logger = new Logger(EnrollBusinessScraperService.name);

  public async scrapeEnrollBusiness(
    filters: FormSearchFilters,
  ): Promise<LocationResponseDto[]> {
    const searchPageUrl = 'https://ca.enrollbusiness.com/sbp?bsn=';

    const browser = await puppeteer.launch({
      headless: true, // Switch to false here if you need to watch it step-by-step
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
        '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      ],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      this.logger.log(`[EnrollBusiness] Initializing base page load...`);
      await page.goto(searchPageUrl, {
        waitUntil: 'networkidle0',
        timeout: 60000,
      });

      // --- STEP 1: PROVINCE SELECTION (Handles Postback Triggers First) ---
      if (filters.province) {
        this.logger.log(
          `[EnrollBusiness] Intercepting Province target: "${filters.province}"`,
        );
        const provinceSelector =
          'select[name*="Province"], select[id*="ddlProvince"]';
        await page.waitForSelector(provinceSelector, { timeout: 10000 });

        const provinceValue = await page.evaluate(
          (provText, sel) => {
            const selectEl = document.querySelector(sel) as HTMLSelectElement;
            const option = Array.from(selectEl?.options || []).find(
              (opt) =>
                opt.text.toLowerCase().trim() === provText.toLowerCase().trim(),
            );
            return option ? option.value : null;
          },
          filters.province,
          provinceSelector,
        );

        if (provinceValue) {
          this.logger.log(
            `[EnrollBusiness] Selecting Province option value: ${provinceValue}. Waiting on server postback...`,
          );

          // EnrollBusiness form elements refresh the page state here. We wait for it to clear.
          await Promise.all([
            page.select(provinceSelector, provinceValue),
            page
              .waitForNavigation({ waitUntil: 'networkidle0', timeout: 20000 })
              .catch(() => {
                this.logger.debug(
                  'Local AJAX hydration resolved successfully.',
                );
              }),
          ]);

          // Give the city drop-down container structural layout elements an extra moment to settle
          await new Promise((resolve) => setTimeout(resolve, 3000));
        }
      }

      // --- STEP 2: CITY SELECTION ---
      if (filters.city) {
        this.logger.log(
          `[EnrollBusiness] Intercepting City target: "${filters.city}"`,
        );
        const citySelector = 'select[name*="City"], select[id*="ddlCity"]';

        try {
          await page.waitForSelector(citySelector, { timeout: 10000 });
          const cityValue = await page.evaluate(
            (cityText, sel) => {
              const selectEl = document.querySelector(sel) as HTMLSelectElement;
              const option = Array.from(selectEl?.options || []).find(
                (opt) =>
                  opt.text.toLowerCase().trim() ===
                  cityText.toLowerCase().trim(),
              );
              return option ? option.value : null;
            },
            filters.city,
            citySelector,
          );

          if (cityValue) {
            this.logger.log(
              `[EnrollBusiness] Selecting City option value: ${cityValue}`,
            );
            await page.select(citySelector, cityValue);
            await new Promise((resolve) => setTimeout(resolve, 1500));
          } else {
            this.logger.warn(
              `[EnrollBusiness] City "${filters.city}" could not be matched inside the loaded dropdown options.`,
            );
          }
        } catch (err) {
          this.logger.warn(
            `[EnrollBusiness] City dropdown control timed out or failed to update.${err}`,
          );
        }
      }

      // --- STEP 3: TEXT INJECTIONS (Done after location selections to avoid being wiped out) ---
      this.logger.log(
        `[EnrollBusiness] Form state stabilized. Injecting Business Name: "${filters.businessName}"`,
      );
      const nameInputSelector = 'input[name*="txtBusinessName"]';
      await page.waitForSelector(nameInputSelector, { timeout: 5000 });
      await page.$eval(
        nameInputSelector,
        (el: HTMLInputElement, val) => {
          el.value = val;
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        },
        filters.businessName,
      );

      // --- STEP 4: CATEGORY ROTATION LOOKUP LOOP ---
      const categoryQueue = [
        filters.category,
        ...DENTAL_CATEGORIES.filter((cat) => cat !== filters.category),
      ];
      let extractedRecords: any[] = [];

      for (const currentCategory of categoryQueue) {
        this.logger.log(
          `[EnrollBusiness Search Loop] Executing Category: "${currentCategory}"`,
        );

        const categoryInputSelector = 'input[name*="txtCategory"]';
        await page.waitForSelector(categoryInputSelector, { timeout: 5000 });
        await page.$eval(
          categoryInputSelector,
          (el: HTMLInputElement, val) => {
            el.value = val;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          },
          currentCategory,
        );

        await new Promise((resolve) => setTimeout(resolve, 500));

        this.logger.log(`[EnrollBusiness] Submitting Form...`);
        const searchButtonSelector =
          'input[type="submit"][value="Search"], .Refine-Search input[type="submit"]';

        await Promise.all([
          page.click(searchButtonSelector),
          page
            .waitForNavigation({ waitUntil: 'networkidle2', timeout: 25000 })
            .catch(() => {}),
        ]);

        await new Promise((resolve) => setTimeout(resolve, 3000));

        // Read result state
        const isNoResultsFound = await page.evaluate(() => {
          const bodyText = document.body.innerText;
          return (
            bodyText.includes('Sorry! We could not find any profile') ||
            bodyText.includes('0 Profiles found')
          );
        });

        if (isNoResultsFound) {
          this.logger.warn(
            `[EnrollBusiness] Category "${currentCategory}" returned 0 profiles. Trying next fallback option...`,
          );
          continue;
        }

        this.logger.log(
          `[EnrollBusiness] Results found with Category: "${currentCategory}"`,
        );
        extractedRecords = await this.parseListingCards(
          page,
          filters.businessName,
        );

        if (extractedRecords.length > 0) break;
      }

      if (extractedRecords.length === 0) {
        this.logger.error(
          `[EnrollBusiness Terminal Status] Searched all alternative configurations but zero results matched.`,
        );
        await browser.close();
        return [];
      }

      const results: LocationResponseDto[] = extractedRecords.map((item) => ({
        name: item.name,
        address: item.address,
        phone: item.phone,
        locationLink: item.profileLink || searchPageUrl,
        source: 'EnrollBusiness',
        timestamp: new Date().toISOString(),
      }));

      await browser.close();
      return results;
    } catch (error) {
      this.logger.error(`[EnrollBusiness Core System Crash]: ${error}`);
      await browser.close();
      return [];
    }
  }

  private async parseListingCards(
    page: Page,
    fallbackName: string,
  ): Promise<
    Array<{
      name: string;
      address: string;
      phone: string;
      profileLink: string;
    }>
  > {
    return page.evaluate((defaultName) => {
      const records: Array<{
        name: string;
        address: string;
        phone: string;
        profileLink: string;
      }> = [];
      const titleElements = Array.from(
        document.querySelectorAll(
          'a[href*="/company/"], h2 a, h3 a, font b a, .company-name a',
        ),
      );
      const uniqueTitles = titleElements.filter(
        (el) => el.textContent?.trim().length > 2,
      );

      if (uniqueTitles.length > 0) {
        uniqueTitles.forEach((titleEl) => {
          const container = titleEl.closest(
            'div, td, table, .search-item, .company-box',
          );
          const name = titleEl.textContent?.trim() || defaultName;
          const profileLink = (titleEl as HTMLAnchorElement).href || '';

          let address = '—';
          let phone = '—';

          if (container) {
            const textNodes = Array.from(
              container.querySelectorAll('span, div, td, p, address'),
            ).map((node) => node.textContent?.trim() || '');

            const locationLine = textNodes.find(
              (t) =>
                t.includes(', Canada') ||
                t.includes('Canada') ||
                /,[A-Z\s]{2,3}\s[A-Z0-9]{3}/i.test(t),
            );
            if (locationLine) {
              address = locationLine.replace(/\s+/g, ' ').trim();
            }

            const phoneClickable = container.querySelector(
              'a[href^="tel:"], span.phone, .phone-number, .phone',
            );
            if (phoneClickable) {
              phone = phoneClickable.textContent?.trim() || '—';
            } else {
              const bodyText = container.textContent || '';
              const match = bodyText.match(
                /(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/,
              );
              if (match) phone = match[0].trim();
            }
          }
          records.push({ name, address, phone, profileLink });
        });
      }

      if (records.length === 0) {
        const visibleAddress = document.body.innerText.match(
          /(?:\d+[^,\n]+,[^,\n]+,\s*[A-Z]{2}\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d[^,\n]*,\s*Canada)/i,
        );
        const visiblePhone = document.body.innerText.match(
          /(?:\d{3}-\d{3}-\d{4})/,
        );

        if (visibleAddress || visiblePhone) {
          records.push({
            name: defaultName,
            address: visibleAddress ? visibleAddress[0].trim() : '—',
            phone: visiblePhone ? visiblePhone[0].trim() : '—',
            profileLink: window.location.href,
          });
        }
      }
      return records.filter(
        (v, i, a) =>
          a.findIndex((t) => t.name === v.name && t.address === v.address) ===
          i,
      );
    }, fallbackName);
  }
}
