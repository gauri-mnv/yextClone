import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from './dto/location-response.dto';
import { GoogleMapsScraperService } from './GoogleMapsScraper.service';
import { YelpScraperService } from './yelpScaper.service';
import { BingScraperService } from './bingScraper.service';
import { Location } from './location.entity';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class ScraperService {
  constructor(
    @InjectRepository(Location)
    private locationRepo: Repository<Location>,
    private googleMapsScraperService: GoogleMapsScraperService,
    private yelpScraperService: YelpScraperService,
    private bingService: BingScraperService,
  ) {}

  //combine
  async scrapeAllPlatforms(
    name: string,
    location: string = '',
  ): Promise<LocationResponseDto[]> {
    await this.locationRepo.clear();
    console.log(`🚀 Starting Multi-Platform Scraping for: ${name}`);

    const [googleData, yelpData, bingData] = await Promise.all([
      this.googleMapsScraperService.scrapeGoogleMaps(`${name} ${location}`),
      this.yelpScraperService.scrapeYelp(`${name} `, `${location}`),
      this.bingService.scrapeBing(name, location),
    ]);
    const combinedData = [...googleData, ...yelpData, ...bingData];

    console.log(
      `📊 Total Results Found: ${combinedData.length} (Google: ${googleData.length}, Yelp: ${yelpData.length},Bing: ${bingData.length})`,
    );

    return combinedData;
  }
}
