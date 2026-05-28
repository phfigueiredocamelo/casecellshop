import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  getHealth() {
    return {
      service: 'fake-erp',
      status: 'ok'
    };
  }
}
