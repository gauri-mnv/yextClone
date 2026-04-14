import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  Param,
  Delete,
  Patch,
} from '@nestjs/common';
import { BusinessService } from './business.service';
import { CreateBusinessDto } from './dto/create-business.dto';
import { LocationResponseDto } from 'src/scraper/dto/location-response.dto';

@Controller('locations-history')
export class BusinessController {
  constructor(private readonly businessService: BusinessService) {}

  @Post('add')
  create(@Body() body: CreateBusinessDto) {
    return this.businessService.create(body);
  }

  @Get('all')
  findAll(@Query('address') address: string) {
    return this.businessService.findAll(address);
  }

  @Get(':id')
  findOne(@Param('id') id: number) {
    return this.businessService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: number, @Body() body: LocationResponseDto) {
    return this.businessService.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: number) {
    return this.businessService.remove(id);
  }
}
