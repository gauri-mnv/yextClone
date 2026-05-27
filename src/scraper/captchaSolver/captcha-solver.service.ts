/* eslint-disable @typescript-eslint/restrict-template-expressions */
import { Injectable, Logger } from '@nestjs/common';
import { Page } from 'playwright';
import { VisionAiService } from './vision-ai.service';

@Injectable()
export class CaptchaSolverService {
  private readonly logger = new Logger(CaptchaSolverService.name);

  constructor(private readonly visionAi: VisionAiService) {}

  async solveCaptcha(
    page: Page,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      // 1. Scope explicitly into the visual puzzle frame locator
      const bframe = page.frameLocator("iframe[src*='recaptcha/api2/bframe']");

      // 2. Extract the item keyword (e.g. "motorcycles" or "traffic lights")
      const promptLocator = bframe.locator(
        '.rc-imageselect-instructions strong',
      );
      await promptLocator.waitFor({ state: 'visible', timeout: 8000 });
      const targetKeyword = (await promptLocator.innerText()).trim();
      this.logger.log(`Target item identified by AI: "${targetKeyword}"`);

      // 3. Capture the exact bounding block of the image grid
      const gridContainer = bframe.locator('.rc-imageselect-target');
      const imageBuffer = await gridContainer.screenshot();

      // 4. Request the array map back from Gemini
      const tilesToClick: number[] =
        (await this.visionAi.getMatchingTiles(imageBuffer, targetKeyword)) ??
        [];
      this.logger.log(
        `Tiles selected to click: ${JSON.stringify(tilesToClick)}`,
      );

      if (tilesToClick.length === 0) {
        this.logger.warn(
          'AI found no matching tiles. Clicking skip/verify anyway.',
        );
      }

      // 5. Query all matching interactive table elements inside the captcha layout
      const tiles = bframe.locator(
        'table.rc-imageselect-table-33 td, table.rc-imageselect-table-44 td',
      );

      for (const index of tilesToClick) {
        // Ensure the index target exists before executing a click payload
        if (index >= 0 && index < (await tiles.count())) {
          await tiles.nth(index).click({
            delay: Math.floor(Math.random() * 120) + 60,
          });
          // Small human variance delay between tile clicks
          await page.waitForTimeout(Math.floor(Math.random() * 300) + 150);
        }
      }

      // 6. Automatically detect and click whatever button is active (Verify / Skip / Next)
      const actionButton = bframe.locator(
        '#recaptcha-verify-button, #recaptcha-skip-button',
      );

      if (await actionButton.isVisible()) {
        const buttonText = await actionButton.innerText();
        this.logger.log(
          `Clicking the action button text: "${buttonText.trim()}"`,
        );

        await actionButton.click({
          delay: Math.floor(Math.random() * 100) + 50,
        });
      } else {
        this.logger.warn('Submit/Skip button was not interactable.');
      }

      return { success: true };
    } catch (error) {
      this.logger.error(`Error inside solver pipeline: ${error}`);
      return { success: false };
    }
  }
}
