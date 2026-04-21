import { Page } from 'playwright';
export async function getPincodeFromAddress(
  page: Page,
  address: string,
): Promise<string> {
  const postalCodeRegex = /[A-Z]\d[A-Z]\s?\d[A-Z]\d/i;
  const existingMatch = address.match(postalCodeRegex);
  if (existingMatch) {
    return existingMatch[0];
  }
  try {
    const googleSearchUrl = `https://www.google.com/search?q=pincode+of+${encodeURIComponent(address)}`;
    await page.goto(googleSearchUrl, { waitUntil: 'domcontentloaded' });

    const pincode = await page.evaluate(() => {
      const bodyText = document.body.innerText;
      const postalCodeRegex = /\b[A-Z]\d[A-Z]\s?\d[A-Z]\d\b|\b\d{6}\b/g;
      const matches = bodyText.match(postalCodeRegex);

      return matches ? matches[0] : null;
    });
    return pincode || '-';
  } catch (error) {
    console.error('❌ [Helper] Error fetching pincode:', error);
    return address;
  }
}
