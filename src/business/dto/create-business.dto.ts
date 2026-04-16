/* eslint-disable @typescript-eslint/no-unsafe-call */
import {
  IsNotEmpty,
  IsString,
  IsOptional,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';

export class BusinessHourDto {
  @IsString()
  dayOfWeek!: string;

  @IsString()
  openTime!: string;

  @IsString()
  closeTime!: string;
}
export class CreateBusinessDto {
  @IsString()
  @IsNotEmpty({ message: 'Business name is mandatory' })
  businessName!: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  phone: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  // eslint-disable-next-line prettier/prettier
  additionalAttributes?:any;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => BusinessHourDto)
  hours?: BusinessHourDto[];
}

// Update Business
export class UpdateBusinessDto {
  @IsOptional() @IsString() businessName?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() city?: string;
  @IsOptional() phone: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() additionalAttributes: any;
}
