import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ErpService } from './erp.service';

@Controller('erp')
export class BillingController {
  constructor(private readonly erpService: ErpService) {}

  @Post('billing')
  billOrder(@Body() body: { orderId: string; billingKey: string }) {
    return this.erpService.billOrder(body.orderId, body.billingKey);
  }

  @Get('billing/:orderId')
  async getBillingStatus(@Param('orderId') orderId: string) {
    const billing = this.erpService.getBillingStatus(orderId);

    if (!billing) {
      return {
        orderId,
        invoiceId: null
      };
    }

    return {
      orderId,
      ...billing
    };
  }
}
