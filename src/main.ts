/* eslint-disable @typescript-eslint/no-floating-promises */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // main.ts
  // Yeh line DTO ke decorators (@IsString etc.) ko active karti hai
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: false, // Jo fields DTO mein nahi hain, unhe remove kar do
      forbidNonWhitelisted: true, // Agar extra fields aayin toh error throw karo
      transform: true, // Data ko automatic sahi type mein badlo
    }),
  );
  app.enableCors();
  await app.listen(process.env.PORT ?? 4000);
  console.log(
    `Server is running on port : http://localhost:${process.env.PORT ?? 4000}`,
  );
}
bootstrap();
