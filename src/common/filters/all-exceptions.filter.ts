import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const message = isHttpException
      ? (exception as HttpException).getResponse()
      : 'Internal server error';

    // Never throw here; always reply with a JSON shape
    response.status(status).json({
      statusCode: status,
      success: false,
      error:
        typeof message === 'string'
          ? message
          : (message as Record<string, unknown>)?.['message'] ?? message,
      timestamp: new Date().toISOString(),
    });
  }
}


