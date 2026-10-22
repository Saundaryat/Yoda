import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { TasksService } from './tasks.service.js';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get()
  async list() {
    const rows = await this.tasks.list();
    return rows.map(({ definition, ...row }) => ({
      ...row,
      group: definition.group,
      sessions: definition.sessions.length,
      checks: definition.checks.length,
    }));
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tasks.get(id);
  }
}
