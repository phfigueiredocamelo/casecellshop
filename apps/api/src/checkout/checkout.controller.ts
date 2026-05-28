import { Body, Controller, Headers, HttpCode, Post, Res } from '@nestjs/common';
import { CheckoutRequest, CheckoutService } from './checkout.service';

@Controller()
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('checkout')
  async checkout(
    @Headers('x-customer-id') customerId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CheckoutRequest,
    @Res({ passthrough: true }) res: { status: (code: number) => unknown }
  ) {
    const result = await this.checkoutService.checkout(customerId, idempotencyKey, body);
    res.status(result.httpStatus);

    return result.body;
  }
}
