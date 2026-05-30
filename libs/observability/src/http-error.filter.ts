import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable
} from '@nestjs/common';
import { RequestContextService } from './request-context.service';

interface HttpRequestLike {
  url: string;
}

interface HttpResponseLike {
  status(code: number): { json(body: unknown): void };
}

@Catch()
@Injectable()
export class HttpErrorFilter implements ExceptionFilter {
  constructor(private readonly requestContext: RequestContextService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const request = http.getRequest<HttpRequestLike>();
    const response = http.getResponse<HttpResponseLike>();
    const context = this.requestContext.get();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const message =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'message' in exceptionResponse
        ? (exceptionResponse as { message: string | string[] }).message
        : exception instanceof Error
          ? exception.message
          : 'Internal server error';
    const error =
      typeof exceptionResponse === 'object' &&
      exceptionResponse !== null &&
      'error' in exceptionResponse
        ? String((exceptionResponse as { error: string }).error)
        : HttpStatus[status] ?? 'Error';

    response.status(status).json({
      statusCode: status,
      error,
      message,
      requestId: context?.requestId,
      correlationId: context?.correlationId,
      ...(context?.orderId ? { orderId: context.orderId } : {}),
      path: request.url
    });
  }
}
