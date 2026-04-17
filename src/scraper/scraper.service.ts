import { Injectable } from '@nestjs/common';
import { LocationResponseDto } from './dto/location-response.dto';
import { GoogleMapsScraperService } from './multiService/GoogleMapsScraper.service';
import { YelpScraperService } from '../scraper/multiService/yelpScaper.service';
import { BingScraperService } from '../scraper/multiService/bingScraper.service';
import { InstagramScraperService } from '../scraper/multiService/instagramScraper.service';
import { N49ScraperService } from '../scraper/multiService/n49Scraper.service';
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
    private instagramService: InstagramScraperService,
    private n49Service: N49ScraperService,
  ) {}

  //combine
  async scrapeAllPlatforms(
    name: string,
    location: string = '',
  ): Promise<LocationResponseDto[]> {
    await this.locationRepo.clear();
    console.log(`🚀 Starting Multi-Platform Scraping for: ${name}`);

    const [googleData, yelpData, bingData, instagramData, N49ScraperData] =
      await Promise.all([
        this.googleMapsScraperService.scrapeGoogleMaps(`${name} ${location}`),
        this.yelpScraperService.scrapeYelp(`${name} `, `${location}`),
        this.bingService.scrapeBing(name, location),
        this.instagramService.scrapeInstagram(name, location),
        this.n49Service.scrapeN49(name, location),
      ]);
    const combinedData = [
      ...googleData,
      ...yelpData,
      ...bingData,
      ...instagramData,
      ...N49ScraperData, // const [googleData, yelpData, bingData, instagramData, N49ScraperData] =
      //   await Promise.all([
      //     this.googleMapsScraperService.scrapeGoogleMaps(`${name} ${location}`),
      //     this.yelpScraperService.scrapeYelp(`${name} `, `${location}`),
      //     this.bingService.scrapeBing(name, location),
      //     this.instagramService.scrapeInstagram(name, location),
      //     this.n49Service.scrapeN49(name, location),
      //   ]);
      // const combinedData = [...N49ScraperData];
    ];

    // const [googleData, yelpData, bingData, instagramData, N49ScraperData] =
    //   await Promise.all([
    //     this.googleMapsScraperService.scrapeGoogleMaps(`${name} ${location}`),
    //     this.yelpScraperService.scrapeYelp(`${name} `, `${location}`),
    //     this.bingService.scrapeBing(name, location),
    //     this.instagramService.scrapeInstagram(name, location),
    //     this.n49Service.scrapeN49(name, location),
    //   ]);
    // const combinedData = [...N49ScraperData];

    console.log(
      `📊 Total Results Found: ${combinedData.length} (Google: ${googleData.length}, Yelp: ${yelpData.length},Bing: ${bingData.length}, Instagram : ${instagramData.length} , N49Scraper:${N49ScraperData.length})`,
    );
    // console.log(
    //   `📊 Total Results Found: ${combinedData.length} (N49Scraper:${N49ScraperData.length})`,
    // );

    return combinedData;
  }
}
