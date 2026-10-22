import { Module } from '@nestjs/common';
import { SkillsModule } from '../skills/skills.module.js';
import { ConfigurationsController } from './configurations.controller.js';
import { ConfigurationsService } from './configurations.service.js';

@Module({
  imports: [SkillsModule],
  controllers: [ConfigurationsController],
  providers: [ConfigurationsService],
  exports: [ConfigurationsService],
})
export class ConfigurationsModule {}
