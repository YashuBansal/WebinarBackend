import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as express from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
        'https://da5f61e2268f.ngrok-free.app', 
        'https://dashboard.webinarleadshub.com',
        'https://msg.webinarleadshub.com',
        'https://livezoom.webinarleadshub.com',
      ];

      // allow requests with no origin (e.g., Postman)
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        console.log('Blocked by CORS:', origin);
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true, // important for sending cookies
    preflightContinue: false,
  });
  const PORT = process.env.PORT ?? 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use(cookieParser());

  // Set global prefix
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe());

  await app.listen(PORT);
  console.log(
    `process running on PORT ${PORT} ==================================== `,
  );
}
bootstrap();
