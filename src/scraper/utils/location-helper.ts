// utils/location-helper.ts
import { Page } from 'playwright';

export async function getPincodeFromAddress(
  page: Page,
  address: string,
): Promise<string> {
  const postalCodeRegex = /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i;
  const existingMatch = address.match(postalCodeRegex);
  if (existingMatch) {
    //console.log(`🎯 [Helper] Found Pincode in string: ${existingMatch[0]}`);
    return existingMatch[0];
  }
  try {
    //console.log(`🔍 [Helper] Fetching Pincode for: ${address}`);

    const googleSearchUrl = `https://www.google.com/search?q=pincode+of+${encodeURIComponent(address)}`;
    //console.log(
    //  `🔗 [Helper] Navigating to Google Search... : ${googleSearchUrl}`,
    //);
    await page.goto(googleSearchUrl, { waitUntil: 'domcontentloaded' });

    const pincode = await page.evaluate(() => {
      // Google aksar pincode ko bold ya specific classes mein dikhata hai
      // Canadian Postal Codes (T4A 0R8) ya Indian Pincodes (431001) ke liye Regex
      const bodyText = document.body.innerText;
      const postalCodeRegex = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b\d{6}\b/g;
      const matches = bodyText.match(postalCodeRegex);

      return matches ? matches[0] : null;
    });
    // console.log(`📍 [Helper] Fetched Pincode: ${pincode}`);
    return pincode || '-';
  } catch (error) {
    console.error('❌ [Helper] Error fetching pincode:', error);
    return address;
  }
}
