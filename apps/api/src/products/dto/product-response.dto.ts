import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ProductResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  sku!: string;

  @ApiProperty()
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  imageUrl!: string | null;

  @ApiPropertyOptional({ nullable: true })
  brand!: string | null;

  @ApiProperty()
  priceCents!: number;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  availableQty!: number;

  @ApiProperty()
  inStock!: boolean;
}
