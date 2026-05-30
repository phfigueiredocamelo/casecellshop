import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CheckoutItemDto {
  @ApiProperty({ example: 'prod_case_iphone_15_clear' })
  productId!: string;

  @ApiProperty({ example: 2, minimum: 1 })
  quantity!: number;
}

export class CheckoutRequestDto {
  @ApiProperty({ type: [CheckoutItemDto] })
  items!: CheckoutItemDto[];
}

export class CheckoutAcceptedResponseDto {
  @ApiProperty()
  orderId!: string;

  @ApiProperty({ example: 'PENDING_ERP' })
  status!: string;

  @ApiProperty({ example: 5990 })
  totalCents!: number;

  @ApiProperty({ example: 'BRL' })
  currency!: string;

  @ApiPropertyOptional({ example: 'customer-123' })
  customerId?: string;
}
