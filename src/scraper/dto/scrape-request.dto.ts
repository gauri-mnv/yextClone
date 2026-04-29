import { IsString, MinLength, IsNotEmpty, IsOptional } from 'class-validator';

export class ScrapeRequestDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2, { message: 'Business name is too short' })
  name: string;

  @IsString()
  @IsOptional()
  location: string;

  @IsString()
  @IsOptional()
  phone: string;
}
