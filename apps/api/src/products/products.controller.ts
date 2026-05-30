import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags
} from '@nestjs/swagger';
import { ProductListResponseDto } from './dto/product-list-response.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  @ApiOperation({ summary: 'List products' })
  @ApiQuery({ name: 'brand', required: false })
  @ApiQuery({ name: 'device', required: false })
  @ApiQuery({ name: 'sort', required: false, enum: ['relevance', 'price_asc', 'price_desc'] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  @ApiOkResponse({ type: ProductListResponseDto })
  listProducts(
    @Query('brand') brand?: string,
    @Query('device') device?: string,
    @Query('sort') sort?: 'relevance' | 'price_asc' | 'price_desc',
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string
  ) {
    return this.productsService.listProducts({
      brand,
      device,
      sort,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a product by id' })
  @ApiOkResponse({ type: ProductResponseDto })
  async getProduct(@Param('id') id: string) {
    const product = await this.productsService.getProductById(id);

    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    return product;
  }
}
