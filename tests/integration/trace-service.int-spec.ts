import { LoggerService } from '../../libs/observability/src/logger.service';
import { RequestContextService } from '../../libs/observability/src/request-context.service';
import { TraceService } from '../../libs/observability/src/trace.service';

describe('TraceService', () => {
  it('emits span.finished logs with trace and correlation fields', async () => {
    const requestContext = new RequestContextService();
    const logger = new LoggerService(requestContext);
    const infoSpy = jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    const trace = new TraceService(requestContext, logger);
    const base = requestContext.create({
      requestId: 'req-test',
      correlationId: 'corr-test',
      traceId: 'trace-test'
    });

    const result = await requestContext.run(base, () =>
      trace.startSpan('cache.get', async () => 'ok')
    );

    expect(result).toBe('ok');
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'span.finished',
        operation: 'cache.get',
        traceId: 'trace-test',
        correlationId: 'corr-test',
        requestId: 'req-test',
        status: 'ok'
      }),
      'span finished'
    );
  });
});
