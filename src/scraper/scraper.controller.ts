import {
  Body,
  Controller,
  Post,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ScrapeRequestDto } from './dto/scrape-request.dto';
import { ScraperService } from './scraper.service';

@Controller('scrape')
export class ScraperController {
  constructor(private readonly scraperService: ScraperService) {}
  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async getLocations(@Body() scrapeDto: ScrapeRequestDto) {
    return this.scraperService.scrapeAllPlatforms(
      scrapeDto.name,
      scrapeDto.location,
    );
  }
}
