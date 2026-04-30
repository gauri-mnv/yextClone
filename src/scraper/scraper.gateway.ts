import {
  WebSocketGateway,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { ScraperService } from './scraper.service';
import { ScrapeRequestDto } from './dto/scrape-request.dto';

@WebSocketGateway({
  cors: {
    origin: ['*', 'http://localhost:3000'], //allow all origins for simplicity, adjust in production
    methods: ['GET', 'POST'],
    credentials: true,
  },
})
export class ScraperGateway {
  @WebSocketServer()
  server: Server;

  constructor(private readonly scraperService: ScraperService) {}

  @SubscribeMessage('startScraping')
  async handleScrape(
    @MessageBody() data: ScrapeRequestDto,
    @ConnectedSocket() client: Socket,
  ) {
    await this.scraperService.scrapeAllPlatforms(
      data.name,
      data.location,
      data.phone,
      (singleResult) => {
        // Jaise hi ek source khatam hoga, ye block chalega
        client.emit('dataChunk', singleResult);
      },
    );

    client.emit('scrapingFinished', { message: 'All sources completed' });
  }
}
