import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ExperimentsService } from './experiments.service.js';

@Controller('runs')
export class RunsController {
  constructor(private readonly experiments: ExperimentsService) {}

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.experiments.run(id);
  }
}
