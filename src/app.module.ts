import { Module } from '@nestjs/common';
import { BusinessModule } from './business/business.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScraperModule } from './scraper/scraper.module';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: 'localhost',
      port: 5432,
      username: 'postgres',
      password: 'admin@123',
      database: 'yext_clone_db',
      autoLoadEntities: true,
      synchronize: true,
    }),
    BusinessModule,
    ScraperModule,
  ],
  controllers: [],
  providers: [],
})
export class AppModule {}
