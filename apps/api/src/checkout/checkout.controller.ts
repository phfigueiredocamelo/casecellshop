import { Body, Controller, Headers, Post, Res } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiUnprocessableEntityResponse
} from '@nestjs/swagger';
import { ApiErrorDto } from '../common/api-error.dto';
import {
  CheckoutAcceptedResponseDto,
  CheckoutRequestDto
} from './dto/checkout.dto';
import { CheckoutRequest, CheckoutService } from './checkout.service';

@ApiTags('checkout')
@Controller()
export class CheckoutController {
  constructor(private readonly checkoutService: CheckoutService) {}

  @Post('checkout')
  @ApiOperation({ summary: 'Create a checkout' })
  @ApiHeader({ name: 'X-Customer-Id', required: true })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiHeader({ name: 'X-Correlation-Id', required: false })
  @ApiBody({ type: CheckoutRequestDto })
  @ApiOkResponse({ type: CheckoutAcceptedResponseDto, description: 'Idempotent replay already completed' })
  @ApiResponse({ status: 202, type: CheckoutAcceptedResponseDto, description: 'Checkout accepted' })
  @ApiBadRequestResponse({ type: ApiErrorDto })
  @ApiConflictResponse({ type: ApiErrorDto })
  @ApiUnprocessableEntityResponse({ type: ApiErrorDto })
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
