import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProductResponseDto } from './product-response.dto';

export class ProductListMetaDto {
  @ApiProperty()
  brand!: string;

  @ApiProperty()
  device!: string;

  @ApiProperty()
  sort!: 'relevance' | 'price_asc' | 'price_desc';

  @ApiProperty()
  page!: number;

  @ApiProperty()
  pageSize!: number;

  @ApiProperty()
  catalogVersion!: number;

  @ApiProperty()
  cache!: string;

  @ApiPropertyOptional()
  retryLater?: boolean;

  @ApiPropertyOptional()
  degraded?: boolean;

  @ApiPropertyOptional({ type: [String] })
  missingProductCardIds?: string[];

  @ApiPropertyOptional()
  missingProductCards?: number;
}

export class ProductListResponseDto {
  @ApiProperty({ type: [ProductResponseDto] })
  items!: ProductResponseDto[];

  @ApiProperty({ type: ProductListMetaDto })
  meta!: ProductListMetaDto;
}
