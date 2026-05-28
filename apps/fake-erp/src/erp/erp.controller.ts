import { Body, Controller, Get, Post } from '@nestjs/common';
import { ErpCatalogProduct } from '../../../../prisma/catalog-data';
import { ErpService } from './erp.service';

@Controller('erp')
export class ErpController {
  constructor(private readonly erpService: ErpService) {}

  @Get('products')
  getProducts() {
    return this.erpService.getProducts();
  }

  @Post('catalog')
  setCatalog(@Body() body: { products: ErpCatalogProduct[] }) {
    return this.erpService.setCatalog(body.products);
  }
}
