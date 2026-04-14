import { IsString, MinLength, IsNotEmpty } from 'class-validator';

export class ScrapeRequestDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(3, { message: 'Query must be at least 3 characters long' })
  query: string;

  // @IsOptional() @IsNumber() limit?: number;
}
