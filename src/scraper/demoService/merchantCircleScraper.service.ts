import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

@Injectable()
export class MerchantCircleScraperService {
    async scrapeMerchantCircle(
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
            console.log(`🔍 Search URL: ${searchUrl}`);

            // 2. Visit search results page
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('h3.company-item-title', { timeout: 20000 });

            // 3. Extract listings from search results
            const listings = await page.evaluate(() => {
                const items = Array.from(document.querySelectorAll('div.company-item'));

                return items
                    .map((item) => {
                        const titleAnchor = item.querySelector<HTMLAnchorElement>(
                            'h3.company-item-title a',
                        );
                        const addressAnchor = item.querySelector<HTMLAnchorElement>(
                            'div.company-item-address a.directions',
                        );
                        const phoneAnchor = item.querySelector<HTMLAnchorElement>(
                            'a.company-item-phone',
                        );

                        return {
                            name: titleAnchor?.textContent?.trim() ?? '',
                            link: titleAnchor?.href ?? '',
                            address: addressAnchor?.textContent?.trim() ?? '',
                            phone:
                                phoneAnchor?.textContent?.trim() ??
                                phoneAnchor?.href?.replace('tel:', '') ??
                                '',
                        };
                    })
                    .filter((l) => l.name && l.link);
            });

            console.log(`Found ${listings.length} listings`);
            if (!listings.length) {
                console.error('No listings found');
                return [];
            }

            // 4. Pick best match
            const bestMatch = this.findBestMatch(listings, name);
            console.log(`✅ Best match: "${bestMatch.name}" → ${bestMatch.link}`);

            // 5. Visit detail page
            await page.goto(bestMatch.link, {
                waitUntil: 'domcontentloaded',
                timeout: 30000,
            });

            // Wait for the exact business title from your screenshot
            await page.waitForSelector('h1.business-info-title', { timeout: 15000 });

            // 6. Scrape detail page using exact selectors
            const details = await page.evaluate(() => {
                // Name
                const name = document.querySelector('h1.business-info-title')?.textContent?.trim() ?? 'N/A';

                // Phone
                const phone = document.querySelector('span[itemprop="telephone"]')?.textContent?.trim() ?? 'N/A';

                // Address parts
                const street = document.querySelector('span[itemprop="streetAddress"]')?.textContent?.trim() ?? '';
                const city = document.querySelector('span[itemprop="addressLocality"]')
                    ?.textContent?.trim()
                    .replace(/,$/, '')   // strip trailing comma
                    .trim() ?? '';
                const state = document.querySelector('span[itemprop="addressRegion"]')?.textContent?.trim() ?? '';
                const zip = document.querySelector('span[itemprop="postalCode"]')?.textContent?.trim() ?? '';
                const address = [street, city, state, zip].filter(Boolean).join(', ') || 'N/A';
                return { name, phone, address };
            });

            return [
                {
                    name: details.name,
                    address: details.address,
                    phone: details.phone,
                    source: 'MerchantCircle',
                    locationLink: bestMatch.link,
                    timestamp: new Date().toISOString(),
                },
            ];
        } catch (error) {
            console.error('Scraper Error:', error);
            await page.screenshot({ path: 'merchantcircle-error.png' });
            return [];
        } finally {
            await browser.close();
        }
    }

    // Build search URL 
    // Pattern: /search?q=Playa+Family+Dentistry&qn=Tampa%2C+FL
    private buildSearchUrl(name: string, location: string): string {
        const q = encodeURIComponent(name.trim()).replace(/%20/g, '+');
        const qn = encodeURIComponent(location.trim()).replace(/%20/g, '+');
        return `https://www.merchantcircle.com/search?q=${q}&qn=${qn}`;
    }

    // Best name match: exact substring → word-overlap score
    private findBestMatch(
        listings: { name: string; link: string; address: string; phone: string }[],
        query: string,
    ): { name: string; link: string; address: string; phone: string } {
        const q = query.toLowerCase();

        const exact = listings.find((l) => l.name.toLowerCase().includes(q));
        if (exact) return exact;

        const words = q.split(/\s+/);
        return listings.reduce<{ name: string; link: string; address: string; phone: string; score: number }>(
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