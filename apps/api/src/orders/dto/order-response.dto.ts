import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class OrderItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  productId!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  productName!: string;

  @ApiProperty()
  quantity!: number;

  @ApiProperty()
  unitPriceCents!: number;
}

export class IntegrationAttemptDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  orderId!: string;

  @ApiProperty()
  operation!: string;

  @ApiProperty()
  attemptNumber!: number;

  @ApiProperty()
  status!: string;

  @ApiPropertyOptional()
  errorMessage?: string | null;

  @ApiPropertyOptional()
  correlationId?: string | null;
}

export class OutboxEventDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  aggregateType!: string;

  @ApiProperty()
  aggregateId!: string;

  @ApiProperty()
  eventType!: string;

  @ApiProperty()
  status!: string;
}

export class OrderResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiPropertyOptional()
  idempotencyKey?: string | null;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  totalCents!: number;

  @ApiProperty()
  currency!: string;

  @ApiPropertyOptional()
  erpInvoiceId?: string | null;

  @ApiPropertyOptional()
  failureReason?: string | null;

  @ApiProperty({ type: [OrderItemDto] })
  items!: OrderItemDto[];

  @ApiProperty({ type: [OutboxEventDto] })
  outboxEvents!: OutboxEventDto[];

  @ApiProperty({ type: [IntegrationAttemptDto] })
  attempts!: IntegrationAttemptDto[];
}

export class IdempotencyEntryResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  customerId!: string;

  @ApiProperty()
  key!: string;

  @ApiProperty()
  requestHash!: string;

  @ApiPropertyOptional()
  orderId?: string | null;

  @ApiProperty()
  status!: string;
}
