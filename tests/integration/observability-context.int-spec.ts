import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../apps/api/src/app.module';
import { PrismaService } from '../../libs/db/src';
import { HttpErrorFilter } from '../../libs/observability/src/http-error.filter';
import { RequestContextMiddleware } from '../../libs/observability/src/request-context.middleware';
import { RequestContextService } from '../../libs/observability/src/request-context.service';

describe('observability context', () => {
  it('sets request and correlation headers through middleware', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(PrismaService)
      .useValue({
        catalogVersion: {
          findUnique: jest.fn().mockResolvedValue({ key: 'catalog', version: 1 })
        },
        product: {
          findMany: jest.fn().mockResolvedValue([])
        }
      })
      .compile();

    const middleware = moduleRef.get(RequestContextMiddleware);
    const setHeader = jest.fn();
    const next = jest.fn();

    middleware.use(
      {
        header: (name: string) => (name === 'x-correlation-id' ? 'corr-test-1' : undefined)
      } as never,
      {
        setHeader
      } as never,
      next
    );

    expect(setHeader).toHaveBeenCalledWith('X-Correlation-Id', 'corr-test-1');
    expect(setHeader.mock.calls[0][0]).toBe('X-Request-Id');
    expect(String(setHeader.mock.calls[0][1])).toMatch(/^req_/);
    expect(next).toHaveBeenCalled();

    await moduleRef.close();
  });

  it('includes requestId and correlationId in standard error responses', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule]
    })
      .overrideProvider(PrismaService)
      .useValue({
        catalogVersion: {
          findUnique: jest.fn().mockResolvedValue({ key: 'catalog', version: 1 })
        },
        product: {
          findMany: jest.fn().mockResolvedValue([])
        }
      })
      .compile();

    const requestContext = moduleRef.get(RequestContextService);
    const filter = moduleRef.get(HttpErrorFilter);
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const context = requestContext.create({
      correlationId: 'corr-checkout-error',
      requestId: 'req-checkout-error',
      traceId: 'trace-checkout-error'
    });

    await requestContext.run(context, () =>
      filter.catch(
        new BadRequestException('Checkout requires at least one item'),
        {
          switchToHttp: () => ({
            getRequest: () => ({ url: '/checkout' }),
            getResponse: () => ({ status })
          })
        } as never
      )
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Checkout requires at least one item',
        requestId: 'req-checkout-error',
        correlationId: 'corr-checkout-error',
        path: '/checkout'
      })
    );

    await moduleRef.close();
  });
});
