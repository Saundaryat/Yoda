import { Controller, Get } from '@nestjs/common';
import { SkillsService } from './skills.service.js';

@Controller('skills')
export class SkillsController {
  constructor(private readonly skills: SkillsService) {}

  @Get()
  list() {
    return this.skills.list();
  }
}
