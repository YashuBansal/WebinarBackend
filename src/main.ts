import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  // Set Winston as the global logger
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));
  
  app.enableCors({
    origin: (origin, callback) => {
      const allowedOrigins = [
        'http://domain1.local:5173',
        'http://domain2.local:5174',
        'http://localhost:5173',
        'http://127.0.0.1:5174',
        'http://127.0.0.1:5173',
        'http://localhost:5174',
        'http://localhost:5175',
        'https://localhost:5174',
        'https://localhost:5173',
        'http://localhost:3000',                                                                                                                                                            
        'http://localhost:3002',                                                                                                                                                            
        'https://da5f61e2268f.ngrok-free.app', 
        'https://dashboard.webinarleadshub.com',
        'https://msg.webinarleadshub.com',
        'https://livezoom.webinarleadshub.com',
        'https://dashboard.ajaybansal.com',
        'https://msg.ajaybansal.com',
        'https://livezoom.ajaybansal.com',
      ];

      // allow requests with no origin (e.g., Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log('Blocked by CORS:', origin);
        // Do not throw an error here; simply disallow the origin safely
        callback(null, false);
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true, // important for sending cookies
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });
  const PORT = process.env.PORT ?? 3001;

  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());

  // Set global prefix
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe());

  // Global HTTP exception filter to prevent crashes and standardize error responses
  // app.useGlobalFilters(new AllExceptionsFilter());

  // Always handle preflight gracefully to avoid CORS-related crashes
  const expressInstance = app.getHttpAdapter().getInstance?.();
  if (expressInstance?.options) {
    expressInstance.options('*', (_req: Request, res: Response) => {
      res.sendStatus(204);
    });
  }

  // Express-level fallback error handler so middleware errors never crash the app
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
    try {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`Express error: ${message}`);
    } catch (_) {
      // ignore logger errors
    }
    if (res.headersSent) return; // let Express finalize if already started
    res.status(500).json({ success: false, error: 'Internal server error' });
  });

  // Process-level guards to prevent app crashes on unhandled errors
  process.on('unhandledRejection', (reason: unknown) => {
    const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
    logger.error(`Unhandled Rejection: ${String(reason)}`);
  });
  process.on('uncaughtException', (err: Error) => {
    const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
    logger.error(`Uncaught Exception: ${err.message}`, err.stack);
  });

  await app.listen(PORT);
  console.log(
    `process running on PORT ${PORT} ==================================== `,
  );
}
bootstrap();