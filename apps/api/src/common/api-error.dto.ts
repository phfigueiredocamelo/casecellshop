import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorDto {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({ example: 'Conflict' })
  error!: string;

  @ApiProperty({ example: 'Idempotency key reused with different payload' })
  message!: string | string[];

  @ApiProperty({ example: 'req_01HX...' })
  requestId!: string;

  @ApiProperty({ example: 'corr_01HX...' })
  correlationId!: string;

  @ApiPropertyOptional({ example: 'ord_01HX...' })
  orderId?: string;

  @ApiPropertyOptional({ example: '/checkout' })
  path?: string;
}
