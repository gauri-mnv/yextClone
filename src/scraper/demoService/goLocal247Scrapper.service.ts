// // Chrome POPUP

// import { Injectable } from '@nestjs/common';
// import { chromium } from 'playwright';
// import { LocationResponseDto } from '../dto/location-response.dto';

// @Injectable()
// export class GoLocalScraperService {
//     async scrapeGoLocal(
//         name: string,
//         location: string,
//     ): Promise<LocationResponseDto[]> {
//         const browser = await chromium.launch({
//             headless: false, // keep false (Cloudflare block otherwise)
//             slowMo: 80,
//         });

//         const context = await browser.newContext({
//             userAgent:
//                 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
//             viewport: { width: 1280, height: 720 },
//         });

//         const page = await context.newPage();

//         // Remove webdriver flag
//         await page.addInitScript(() => {
//             Object.defineProperty(navigator, 'webdriver', {
//                 get: () => undefined,
//             });
//         });

//         try {
//             // 1️.Open homepage
//             await page.goto('https://www.golocal247.com/', {
//                 waitUntil: 'domcontentloaded',
//             });

//             await page.waitForTimeout(2000);

//             // 2.Select inputs (use stable IDs)
//             const nameInput = page.locator(
//                 '#golocal_golocal247bundle_business_search_what',
//             );

//             const locationInput = page.locator(
//                 '#golocal_golocal247bundle_business_search_where',
//             );

//             // CLEAR NAME INPUT
//             await nameInput.click();
//             await nameInput.press('Control+A');
//             await nameInput.press('Backspace');
//             await page.waitForTimeout(300);

//             await nameInput.type(name, { delay: 100 });


//             // FORCE REMOVE PRE-FILLED
//             await locationInput.evaluate((el) => {
//                 const input = el as HTMLInputElement;
//                 input.value = '';
//                 input.dispatchEvent(new Event('input', { bubbles: true }));
//                 input.dispatchEvent(new Event('change', { bubbles: true }));
//             });

//             await page.waitForTimeout(300);

//             // TYPE LOCATION LIKE HUMAN
//             await locationInput.click();
//             await locationInput.type(location, { delay: 120 });

//             await page.waitForTimeout(500);


//             // FORCE FINAL VALUE (ANTI-AUTOFILL)
//             await locationInput.evaluate((el, value) => {
//                 const input = el as HTMLInputElement;
//                 input.value = value;
//                 input.dispatchEvent(new Event('input', { bubbles: true }));
//                 input.dispatchEvent(new Event('change', { bubbles: true }));
//             }, location);

//             // Blur to lock value
//             await locationInput.press('Tab');

//             await page.waitForTimeout(1000);

//             // 3️.SEARCH
//             await Promise.all([
//                 page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
//                 page.click('button:has-text("Search")'),
//             ]);

//             // 4️.WAIT FOR RESULTS
//             await page.waitForSelector('a[href*="/biz/"]', {
//                 timeout: 20000,
//             });

//             await page.waitForTimeout(1500);

//             // 5.EXTRACT LISTINGS
//             const listings = await page.evaluate(() => {
//                 return Array.from(
//                     document.querySelectorAll('a[href*="/biz/"]'),
//                 ).map((a) => ({
//                     name: a.textContent?.trim() || '',
//                     link: (a as HTMLAnchorElement).href,
//                 }));
//             });

//             if (!listings.length) {
//                 console.log(' No listings found');
//                 return [];
//             }

            
//             // 6️.MATCH BEST RESULT
//             const bestMatch =
//                 listings.find((l) =>
//                     l.name.toLowerCase().includes(name.toLowerCase()),
//                 ) || listings[0];

//             console.log(`✅ Selected: ${bestMatch.name}`);

            
//             // 7️.OPEN DETAIL PAGE
//             await page.goto(bestMatch.link, {
//                 waitUntil: 'domcontentloaded',
//             });

//             await page.waitForTimeout(1500);

            
//             //8.SCRAPE DETAILS
//             const details = await page.evaluate(() => {
//                 const name =
//                     document.querySelector('h1.yext-name')?.textContent?.trim() || 'N/A';

//                 const street =
//                     document.querySelector('.yext-address')?.textContent?.trim() || '';

//                 const city =
//                     document.querySelector('.yext-city')?.textContent?.trim() || '';

//                 const state =
//                     document.querySelector('.yext-state')?.textContent?.trim() || '';

//                 const zip =
//                     document.querySelector('.yext-postalcode')?.textContent?.trim() || '';

//                 const address = [street, city, state, zip]
//                     .filter(Boolean)
//                     .join(', ');

//                 const phone =
//                     document.querySelector('.yext-main-phone')?.textContent?.trim() ||
//                     'N/A';

//                 return { name, address, phone };
//             });

//             return [
//                 {
//                     ...details,
//                     source: 'GoLocal247',
//                     locationLink: bestMatch.link,
//                     timestamp: new Date().toISOString(),
//                 },
//             ];
//         } catch (error) {
//             console.error('Scraper Error:', error);

//             await page.screenshot({ path: 'golocal-error.png' });

//             return [];
//         } finally {
//             await browser.close();
//         }
//     }
// }











// --- Without Chrome POPUP ---

import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

@Injectable()
export class GoLocalScraperService {
    async scrapeGoLocal(
        name: string,
        location: string,
    ): Promise<LocationResponseDto[]> {
        const browser = await puppeteer.launch({
            headless: true,
            executablePath: puppeteer.executablePath(),
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
            ],
        });

        const page = await browser.newPage();

        await page.setUserAgent(
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
            '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        );
        await page.setViewport({ width: 1280, height: 800 });
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'en-US,en;q=0.9',
            Accept:
                'text/html,application/xhtml+xml,application/xml;q=0.9,' +
                'image/avif,image/webp,image/apng,*/*;q=0.8',
            'Upgrade-Insecure-Requests': '1',
        });

        try {
            // 1. Build search URL 
            const searchUrl = this.buildSearchUrl(name, location);
            console.log(` Search URL: ${searchUrl}`);

            //  2. Visit search page 
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('a[href*="/biz/"]', { timeout: 20000 });

            // ── 3. Extract listing links 
            const listings = await page.evaluate(() => {
                // Prefer links inside <h3> tags (main result titles)
                const h3Links = Array.from(
                    document.querySelectorAll('h3 a[href*="/biz/"]'),
                );
                const targets = h3Links.length
                    ? h3Links
                    : Array.from(document.querySelectorAll('a[href*="/biz/"]'));

                const seen = new Set<string>();
                return targets
                    .map((a) => ({
                        name: (a as HTMLAnchorElement).textContent?.trim() ?? '',
                        link: (a as HTMLAnchorElement).href,
                    }))
                    .filter(({ name, link }) => {
                        if (!name || seen.has(link)) return false;
                        seen.add(link);
                        return true;
                    });
            });

            console.log(` Found ${listings.length} listings`);
            if (!listings.length) {
                console.error(' No listings found');
                return [];
            }

            // 4. Pick best match
            const bestMatch = this.findBestMatch(listings, name);
            console.log(`✅ Best match: "${bestMatch.name}" → ${bestMatch.link}`);

            // 5. Visit detail page
            await page.goto(bestMatch.link, { waitUntil: 'domcontentloaded', timeout: 30000 });

            // Wait for the business name heading specifically
            await page.waitForSelector('h1.yext-name', { timeout: 15000 });

            // 6. Scrape details using exact selectors from your HTML
            const details = await page.evaluate(() => {

                // Name
                const name =
                    document.querySelector('h1.yext-name')?.textContent?.trim() ?? 'N/A';

                // Street
                const street =
                    document.querySelector('span.yext-address')?.textContent?.trim() ??
                    document.querySelector('span.address')?.textContent?.trim() ??
                    '';

                // City
                const city =
                    document.querySelector('span.yext-city')?.textContent?.trim() ?? '';

                // State
                const state =
                    document.querySelector('span.yext-state')?.textContent?.trim() ?? '';

                // Zip
                const zip =
                    document.querySelector('span.yext-postalcode')?.textContent?.trim() ?? '';

                const address =
                    [street, city, state, zip].filter(Boolean).join(', ') || 'N/A';

                // Phone
                const phone =
                    (document.querySelector('span.yext-main-phone')?.textContent?.trim() ??
                        // fallback: tel: href
                        (
                            document.querySelector<HTMLAnchorElement>('a[href^="tel:"]')
                                ?.href ?? ''
                        ).replace('tel:', '')) ||
                    'N/A';

                return { name, address, phone };
            });
            
            return [
                {
                    name: details.name,
                    address: details.address,
                    phone: details.phone,
                    source: 'GoLocal247',
                    locationLink: bestMatch.link,
                    timestamp: new Date().toISOString(),
                },
            ];
        } catch (error) {
            const errMsg = (error as Error)?.message ?? '';
            const isTimeoutError =
                /timeout/i.test(errMsg) ||
                (error as { name?: string })?.name === 'TimeoutError' ||
                (error as { constructor?: { name?: string } })?.constructor?.name === 'TimeoutError';

            if (isTimeoutError) {
                console.error('[GoLocal247] Data not found in the given time');
            } else {
                console.error('[GoLocal247] Scraper failed:', errMsg || 'Unknown error');
            }
            await page.screenshot({ path: 'golocal-error.png' });
            return [];
        } finally {
            await browser.close();
        }
    }

    //Build search URL
    // Pattern: /search/Minneapolis%252C-MN/44th+street+Dental
    private buildSearchUrl(name: string, location: string): string {
        const cityState = this.extractCityState(location); // "Minneapolis, MN"
        const [city, state] = cityState.split(',').map((s) => s.trim());

        // GoLocal247 double-encodes the comma: "," → "%2C" → "%252C"
        const locationSlug = `${city}%252C-${state}`;
        const nameSlug = name.trim().replace(/\s+/g, '+');

        return `https://www.golocal247.com/search/${locationSlug}/${nameSlug}`;
    }

    //Extract "City, ST" from free-form location string
    private extractCityState(location: string): string {
        const match = location.match(/([A-Za-z\s]+),\s*([A-Z]{2})\s*$/);
        return match ? `${match[1].trim()}, ${match[2]}` : location.trim();
    }

    //Best name match: exact substring → word-overlap score
    private findBestMatch(
        listings: { name: string; link: string }[],
        query: string,
    ): { name: string; link: string } {
        const q = query.toLowerCase();

        const exact = listings.find((l) => l.name.toLowerCase().includes(q));
        if (exact) return exact;

        const words = q.split(/\s+/);
        return listings.reduce<{ name: string; link: string; score: number }>(
            (best, l) => {
                const score = words.filter((w) =>
                    l.name.toLowerCase().includes(w),
                ).length;
                return score > best.score ? { ...l, score } : best;
            },
            { ...listings[0], score: 0 },
        );
    }
}