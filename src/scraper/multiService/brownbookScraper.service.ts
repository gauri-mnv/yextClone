import { Injectable } from '@nestjs/common';
// import { InjectRepository } from '@nestjs/typeorm';
// import { Repository } from 'typeorm';
// import { Location } from '../location.entity';
import { LocationResponseDto } from '../dto/location-response.dto';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());
@Injectable()
export class BrownbookScraperService {
  constructor() {
    // @InjectRepository(Location)
    // private locationRepo: Repository<Location>,
  }
  async scrapeBrownbook(
    name: string,
    location: string,
  ): Promise<LocationResponseDto[]> {
    const browser = await chromium.launch({
      headless: false,
      args: [
        '--disable-blink-features=AutomationControlled',
        // '--disable-infobars',
        '--window-size=1920,1080',
      ],
    });

    // const context = await browser.newContext({
    //   userAgent:
    //     'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    // });
    const userDataDir = './brownbook_session';
    const context = await chromium.launchPersistentContext(userDataDir, {
      headless: false, // Ek baar manually solve karne ke liye false rakhein
      args: ['--disable-blink-features=AutomationControlled'],
    });
    const page = await context.newPage();

    try {
      console.log('🏠 [Brownbook] Navigating to Home...');
      await page.goto('https://www.brownbook.net/', {
        waitUntil: 'networkidle',
      });

      // 1️⃣ STEP: Open Modal
      console.log('🖱️ [Brownbook] Clicking main search trigger...');
      await page.click('input[placeholder="Business type or name"]');

      // 2️⃣ STEP: Fill Business Name
      const modalInput = '#toolbar-search-input';
      await page.waitForSelector(modalInput, {
        state: 'visible',
        timeout: 5000,
      });
      const cleanName = name.split(',')[0].trim();
      console.log('⌨️ [Brownbook] Entering business name...');
      await page.fill(modalInput, ''); // Pehle clear karo
      await page.type(modalInput, cleanName, { delay: 150 });

      // 3️⃣ STEP: Fill Location (IMPORTANT for accuracy)
      // Location string se city extract karein (e.g., "Airdrie")
      const cityName =
        location.split(',')[1]?.trim() || location.split(',')[0].trim();
      const locationInput = 'input[placeholder="Location"], #city_select';
      console.log(`📍 [Brownbook] Entering city: ${cityName}`);
      await page.type(locationInput, cityName, { delay: 100 });

      // 4️⃣ STEP: Country Check
      const dropdownButton =
        'button[aria-haspopup="dialog"], button:has(span:text("Canada"))';
      const selectedText = await page.innerText(dropdownButton);
      if (!selectedText.includes('Canada')) {
        await page.click(dropdownButton);
        const canadaOption =
          '[role="option"]:has-text("Canada"), div:text-is("Canada")';
        await page.waitForSelector(canadaOption, { state: 'visible' });
        await page.click(canadaOption);
      }

      console.log('🔍 Clicking Search...');
      await page.click(
        'button:text-is("Search"), .bg-primary.text-white.rounded-md',
      );

      // 5️⃣ STEP: Results Handling (Results vs Captcha)
      console.log('⏳ [Brownbook] Waiting for results or captcha...');
      await page.waitForTimeout(3000);
      const resultOrCaptcha = await Promise.race([
        page
          .waitForSelector('.search-results, .business-title', {
            timeout: 20000,
          })
          .then(() => 'RESULTS'),
        page
          .waitForSelector('iframe[title*="reCAPTCHA"]', { timeout: 20000 })
          .then(() => 'CAPTCHA'),
        page
          .waitForSelector('.no-results, :has-text("Results Found 0")', {
            timeout: 20000,
          })
          .then(() => 'ZERO_RESULTS'),
      ]).catch(() => 'TIMEOUT');

      if (resultOrCaptcha === 'CAPTCHA') {
        console.log('🛑 [Brownbook] Captcha Detected! Bypass needed.');
        try {
          // 1. Captcha hamesha ek iframe ke andar hota hai
          // Wait karein jab tak iframe load na ho jaye
          const captchaFrame = await page.waitForSelector(
            'iframe[title*="reCAPTCHA"]',
            { state: 'visible', timeout: 10000 },
          );
          const frame = await captchaFrame.contentFrame();

          if (frame) {
            console.log('🖱️ [Brownbook] Finding checkbox inside iframe...');

            // 2. Checkbox ka selector hamesha '#recaptcha-anchor' hota hai
            const checkbox = await frame.waitForSelector('#recaptcha-anchor', {
              state: 'visible',
              timeout: 5000,
            });

            // 3. Human-like delay aur mouse movement (Fake)
            await page.mouse.move(Math.random() * 500, Math.random() * 500);
            await page.waitForTimeout(1500); // Thoda wait taaki Google ko lage koi read kar raha hai

            // 4. Click the checkbox
            await checkbox.click();
            console.log('✅ [Brownbook] Clicked "I am not a robot" checkbox.');

            // 5. Ab thoda wait karo, agar Google ne "Image Challenge" nahi di toh results load honge
            console.log('⏳ Waiting for results to unlock...');
            await page.waitForTimeout(5000);

            // Check if results appeared now
            const resultsLoaded = await page.isVisible(
              '.search-results, .business-title',
            );
            if (resultsLoaded) {
              console.log(
                '🎉 [Brownbook] Bypass successful! Results are visible now.',
              );
              // Proceed to extraction logic here...
            } else {
              console.log(
                '⚠️ [Brownbook] Captcha ticked but results still hidden. Image challenge might be there.',
              );
              await page.screenshot({ path: 'captcha_challenge.png' });
            }
          }
        } catch (err) {
          console.error(
            '❌ [Brownbook] Failed to interact with captcha iframe:',
            err,
          );
        }
      }

      if (resultOrCaptcha === 'RESULTS') {
        console.log('🎯 [Brownbook] Results loaded! Extracting link...');
        console.log('location', location);
        // 1. Pehle search results page se business link uthao
        const businessLink = await page.evaluate((targetName) => {
          const links = Array.from(
            document.querySelectorAll('a[href*="/business/"]'),
          );
          // Name matching logic taaki sahi business mile
          const match = links.find((a) =>
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            a.textContent?.toLowerCase().includes(targetName.toLowerCase()),
          );
          return match ? (match as HTMLAnchorElement).href : null;
        }, cleanName);

        if (businessLink) {
          console.log(`🔗 [Brownbook] Found Detail Link: ${businessLink}`);

          // 2. Detail page par navigate karo full NAP data ke liye
          await page.goto(businessLink, { waitUntil: 'domcontentloaded' });

          const finalData = await page.evaluate((url) => {
            const getText = (sel: string) =>
              document.querySelector(sel)?.textContent?.trim() || '-';

            // Brownbook specific selectors based on their standard layout
            return {
              name: getText('h1'),
              address: getText('.address, #address, [itemprop="address"]'),
              phone: getText('.phone, #phone_number, [itemprop="telephone"]'),
              website:
                (
                  document.querySelector(
                    'a[href^="http"]:not([href*="brownbook"])',
                  ) as HTMLAnchorElement
                )?.href || '-',
              locationLink: url,
              source: 'Brownbook',
              timestamp: new Date().toISOString(),
            };
          }, businessLink);

          console.log(`✅ [Brownbook] Extracted: ${finalData.name}`);
          // eslint-disable-next-line @typescript-eslint/no-unsafe-return
          return [finalData];
        } else {
          console.log(
            '⚠️ [Brownbook] Business name match nahi hua results mein.',
          );
        }
      }

      return [];
    } catch (e) {
      console.error('❌ [Brownbook] Error:', e);
      return [];
    } finally {
      await browser.close();
    }
  }
}
