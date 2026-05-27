import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
// import { ConfigModule } from '@nestjs/config';
import { ScraperModule } from './scraper/scraper.module';
import { Location } from './scraper/location.entity';

@Module({
  imports: [
    // ConfigModule.forRoot({ isGlobal: true }),
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

// DATABASE_URL=postgresql://postgres:admin@123@localhost:5432/yext_clone_db?schema=public
// PORT = 6000
