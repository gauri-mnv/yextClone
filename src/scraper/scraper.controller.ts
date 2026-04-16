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

  // @Get()
  // @UsePipes(new ValidationPipe({ transform: true }))
  // async getLocations(@Query() queryDto: ScrapeRequestDto) {
  //   // queryDto.query ab safe aur validated hai
  //   return this.scraperService.scrapeGoogleMaps(queryDto.query);
  // }

  // @Post()
  // @UsePipes(new ValidationPipe({ transform: true }))
  // async getLocations(@Body() queryDto: ScrapeRequestDto) {
  //   return this.scraperService.scrapeAllPlatforms(queryDto.query);
  // }

  @Post()
  @UsePipes(new ValidationPipe({ transform: true }))
  async getLocations(@Body() scrapeDto: ScrapeRequestDto) {
    // Ab hum dono parameters pass karenge
    return this.scraperService.scrapeAllPlatforms(
      scrapeDto.name,
      scrapeDto.location,
    );
  }
}
