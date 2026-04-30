import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScraperModule } from './scraper/scraper.module';
import { Location } from './scraper/location.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'admin@123',
      database: 'yext_clone_db',
      entities: [Location],
      autoLoadEntities: true,
      synchronize: true,
    }),
    ScraperModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
