import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { createConfigurationSchema, type CreateConfiguration } from '@evals/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ConfigurationsService } from './configurations.service.js';

@Controller('configurations')
export class ConfigurationsController {
  constructor(private readonly configurations: ConfigurationsService) {}

  @Post()
  create(@Body(new ZodValidationPipe(createConfigurationSchema)) body: CreateConfiguration) {
    return this.configurations.create(body);
  }

  @Get()
  list() {
    return this.configurations.list();
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.configurations.get(id);
  }
}
