import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Health check' })
  @ApiOkResponse({
    schema: {
      type: 'object',
      properties: {
        service: { type: 'string', example: 'api' },
        status: { type: 'string', example: 'ok' }
      }
    }
  })
  getHealth() {
    return {
      service: 'api',
      status: 'ok'
    };
  }
}
