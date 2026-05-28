import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
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
  async getProduct(@Param('id') id: string) {
    const product = await this.productsService.getProductById(id);

    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }

    return product;
  }
}
