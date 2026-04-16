import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, ILike } from 'typeorm';
import { BusinessProfile } from './entities/business.entity';
import { Location } from '../scraper/location.entity';
import { CreateBusinessDto } from './dto/create-business.dto';

import { LocationResponseDto } from 'src/scraper/dto/location-response.dto';

@Injectable()
export class BusinessService {
  constructor(
    @InjectRepository(BusinessProfile)
    private readonly repo: Repository<BusinessProfile>,
    @InjectRepository(Location)
    private readonly locationRepo: Repository<Location>,
  ) {}

  // CREATE
  async create(data: CreateBusinessDto) {
    const newProfile = this.repo.create(data);
    return await this.repo.save(newProfile);
  }

  // READ (All with Filter)
  async findAll(search?: string) {
    return await this.locationRepo.find({
      where: search
        ? [{ address: ILike(`%${search}%`) }, { name: ILike(`%${search}%`) }]
        : {},
    });
  }

  // READ (One)
  async findOne(id: number) {
    const profile = await this.locationRepo.findOne({
      where: { id },
    });
    if (!profile) throw new NotFoundException('search history not found');
    return profile;
  }

  // UPDATE
  async update(id: number, data: LocationResponseDto) {
    await this.findOne(id);
    await this.locationRepo.update(id, data);
    return this.findOne(id);
  }

  // DELETE
  async remove(id: number) {
    const profile = await this.findOne(id);
    return await this.locationRepo.remove(profile);
  }
}
