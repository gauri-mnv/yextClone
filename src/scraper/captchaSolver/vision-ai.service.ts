import { Injectable, Logger } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';

@Injectable()
export class VisionAiService {
  private readonly logger = new Logger(VisionAiService.name);
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = 'AIzaSyCYn-_7wdS3ZkR0jHDLXydZfTosi_AyGCM';

    if (!apiKey) {
      this.logger.error(
        'CRITICAL: GEMINI_API_KEY is missing in your environment variables (.env file)!',
      );
    }

    // Pass configuration explicitly to override Google Cloud Service Account defaults
    this.ai = new GoogleGenAI({
      apiKey: apiKey,
    });
  }

  async getMatchingTiles(
    imageBuffer: Buffer,
    targetKeyword: string,
  ): Promise<number[] | undefined> {
    let attempts = 0;
    while (attempts < 3) {
      try {
        const imagePart = {
          inlineData: {
            data: imageBuffer.toString('base64'),
            mimeType: 'image/png',
          },
        };

        const prompt = `
        You are an automation assistant processing a standard 4x4 reCAPTCHA image grid.
        The user needs to select all tiles containing any part of: "${targetKeyword}".
        
        The grid contains exactly 16 tiles numbered from 0 to 15, ordered from left-to-right, top-to-bottom:
        Row 1: Tiles 0, 1, 2, 3
        Row 2: Tiles 4, 5, 6, 7
        Row 3: Tiles 8, 9, 10, 11
        Row 4: Tiles 12, 13, 14, 15

        Identify which tile indices contain the requested object: "${targetKeyword}".
        Respond STRICTLY with a valid JSON array of numbers. Do not include markdown code block syntax or explanations.
        Example output format: [0, 4, 5]
      `;

        const response = await this.ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: [prompt, imagePart],
        });

        let responseText = response.text ? response.text.trim() : '[]';

        // Clean Markdown syntax if returned
        if (responseText.includes('```')) {
          responseText = responseText
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();
        }

        this.logger.log(
          `Gemini parsed string response content: ${responseText}`,
        );
        const matchedTiles: number[] = JSON.parse(responseText);
        return Array.isArray(matchedTiles) ? matchedTiles : [];
      } catch (error: any) {
        if (error.status === 429) {
          this.logger.warn(
            'Gemini Rate limit hit! Waiting 30 seconds before retry...',
          );
          await new Promise((resolve) => setTimeout(resolve, 30000)); // 30 sec pause
          attempts++;
        } else {
          throw error;
        }
      }
    }
  }
}
