import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from '../dto/location-response.dto';
import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

puppeteer.use(StealthPlugin());

@Injectable()
export class MyLocalServicesScraperService {
    async scrapeMyLocalServices(
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
                '--window-size=1280,800',
            ],
        });

        const page = await browser.newPage();

        // Randomize user agent to look more human
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

        // Override webdriver detection
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            // @ts-ignore
            window.navigator.chrome = { runtime: {} };
            Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
        });

        try {
            // 1. Visit homepage first like a real user
            console.log('[MLS] Visiting homepage...');
            await page.goto('https://www.mylocalservices.com/', {
                waitUntil: 'networkidle2',
                timeout: 30000,
            });
            await this.humanDelay(2000, 3500);

            // 2. Navigate to search URL
            const searchUrl = this.buildSearchUrl(name, location);
            console.log(`[MLS] 🔍 Search URL: ${searchUrl}`);

            await page.goto(searchUrl, {
                waitUntil: 'networkidle2',
                timeout: 30000,
            });
            await this.humanDelay(2000, 3000);

            // 3. Check for results or "no matches"
            const found = await Promise.race([
                page.waitForSelector('a[title^="Click to view the full details"]', { timeout: 15000 }).then(() => 'results'),
                page.waitForFunction(
                    () => document.body.innerText.includes('There are no matching businesses'),
                    { timeout: 15000 },
                ).then(() => 'no-results'),
            ]).catch(() => 'timeout');

            if (found !== 'results') {
                console.log(`[MLS] ${found === 'no-results' ? 'No results found' : 'Timeout waiting for results'}`);
                return [];
            }

            // 4. Extract listings
            const listings = await page.evaluate(() => {
                const anchors = Array.from(
                    document.querySelectorAll<HTMLAnchorElement>('a[title^="Click to view the full details"]'),
                );

                const seen = new Set<string>();
                return anchors
                    .map((a) => {
                        const busName = a.title
                            .replace('Click to view the full details for ', '')
                            .trim();
                        const addressEl = a.querySelector('div:nth-child(2)');
                        const address = addressEl?.textContent?.trim() ?? '';
                        const href = a.getAttribute('href') ?? '';
                        const link = href.startsWith('http')
                            ? href
                            : `https://www.mylocalservices.com${href}`;
                        return { name: busName, link, address };
                    })
                    .filter(({ name, link }) => {
                        if (!name || seen.has(link)) return false;
                        seen.add(link);
                        return true;
                    });
            });

            console.log(`[MLS] Found ${listings.length} listings`);
            if (!listings.length) {
                console.error('[MLS] No listings found');
                return [];
            }

            // 5. Pick best match
            const bestMatch = this.findBestMatch(listings, name, location);
            console.log(`[MLS] -> Best match: "${bestMatch.name}" → ${bestMatch.link}`);

            // 6. Human-like pause before visiting detail page
            await this.humanDelay(1500, 2500);
            await page.goto(bestMatch.link, {
                waitUntil: 'networkidle2',
                timeout: 30000,
            });
            await this.humanDelay(1500, 2500);

            // 7. Wait for detail page content
            await page.waitForSelector('h2, div[itemprop="name"]', { timeout: 15000 });

            // 8. Scrape detail page
            // Detail page structure (from site):
            //   <h2>Wright Smiles Pediatric Dentistry</h2>
            //   50 Remick Blvd / Warren / Ohio / 45066
            //   Tel: (937) 885-2222
            const details = await page.evaluate(() => {
                // Name — try h2 first (main heading on detail page), then itemprop
                const name =
                    document.querySelector('h2')?.textContent?.trim() ??
                    document.querySelector('div[itemprop="name"]')?.textContent?.trim() ??
                    'N/A';

                // Phone — from "Tel:" line or itemprop
                const phone =
                    document.querySelector('span[itemprop="telephone"]')?.textContent?.trim() ??
                    (() => {
                        const telEl = Array.from(document.querySelectorAll('*')).find(
                            (el) => el.textContent?.trim().startsWith('Tel:') && el.children.length === 0,
                        );
                        return telEl?.textContent?.replace('Tel:', '').trim() ?? 'N/A';
                    })();

                // Address parts from structured data
                const streetEl = document.querySelector('span[itemprop="streetAddress"], div[itemprop="streetAddress"]');
                const cityEl = document.querySelector(
                    'span[itemprop="addressLocality"], div.town[itemprop="addressLocality"], div[itemprop="addressLocality"]',
                );
                const stateEl = document.querySelector(
                    'span[itemprop="addressRegion"], div.region[itemprop="addressRegion"], div[itemprop="addressRegion"]',
                );
                const zipEl = document.querySelector(
                    'span[itemprop="postalCode"], div.postal-code[itemprop="postalCode"], div[itemprop="postalCode"]',
                );

                let street = streetEl?.textContent?.trim() ?? '';

                // Fallback: look for address block container
                if (!street) {
                    const addressBlock = document.querySelector('div[itemprop="address"]');
                    if (addressBlock) {
                        const children = Array.from(addressBlock.querySelectorAll('div'));
                        const streetDiv = children.find(
                            (d) =>
                                !d.getAttribute('itemprop') &&
                                !d.className.includes('town') &&
                                !d.className.includes('region') &&
                                !d.className.includes('postal') &&
                                !d.className.includes('country') &&
                                d.textContent?.trim().length > 0,
                        );
                        street = streetDiv?.textContent?.trim() ?? '';
                    }
                }

                const city = cityEl?.textContent?.trim() ?? '';
                const state = stateEl?.textContent?.trim() ?? '';
                const zip = zipEl?.textContent?.trim() ?? '';

                const address = [street, city, state, zip].filter(Boolean).join(', ') || 'N/A';

                return { name, phone, address };
            });

            console.log('[MLS] Details:', details);

            return [
                {
                    name: details.name,
                    address: details.address,
                    phone: details.phone,
                    source: 'MyLocalServices',
                    locationLink: bestMatch.link,
                    timestamp: new Date().toISOString(),
                },
            ];
        } catch (error) {
            console.error('[MLS] Scraper Error:', error);
            await page.screenshot({ path: 'mls-error.png' }).catch(() => {});
            return [];
        } finally {
            await browser.close();
        }
    }

    // Build search URL
    // Pattern: /search?business_type=Wright+Smiles+Pediatric+Dentistry&location=Warren%2C+Ohio
    private buildSearchUrl(name: string, location: string): string {
        const businessType = encodeURIComponent(name.trim()).replace(/%20/g, '+');
        const loc = encodeURIComponent(location.trim()).replace(/%20/g, '+');
        return `https://www.mylocalservices.com/search?business_type=${businessType}&location=${loc}`;
    }

    // Best match: exact name+location → exact name → word-overlap score
    private findBestMatch(
        listings: { name: string; link: string; address: string }[],
        query: string,
        location: string,
    ): { name: string; link: string; address: string } {
        const q = query.toLowerCase();
        const loc = location.toLowerCase().split(',')[0].trim();

        const exactBoth = listings.find(
            (l) =>
                l.name.toLowerCase().includes(q) &&
                l.address.toLowerCase().includes(loc),
        );
        if (exactBoth) return exactBoth;

        const exactName = listings.find((l) => l.name.toLowerCase().includes(q));
        if (exactName) return exactName;

        const words = q.split(/\s+/);
        return listings.reduce<{ name: string; link: string; address: string; score: number }>(
            (best, l) => {
                const score = words.filter((w) =>
                    l.name.toLowerCase().includes(w),
                ).length;
                return score > best.score ? { ...l, score } : best;
            },
            { ...listings[0], score: 0 },
        );
    }

    // Human-like random delay
    private humanDelay(minMs: number, maxMs: number): Promise<void> {
        const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
        return new Promise((r) => setTimeout(r, ms));
    }
}