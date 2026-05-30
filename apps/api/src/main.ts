import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

export function configureOpenApi(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('CaseCellShop API')
    .setDescription('Backend demo API for catalog, checkout, orders, and reconciliation')
    .setVersion('1.0.0')
    .addApiKey({ type: 'apiKey', name: 'X-Customer-Id', in: 'header' }, 'customer-id')
    .addApiKey({ type: 'apiKey', name: 'Idempotency-Key', in: 'header' }, 'idempotency-key')
    .addApiKey({ type: 'apiKey', name: 'X-Correlation-Id', in: 'header' }, 'correlation-id')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document);
  app.getHttpAdapter().getInstance().get('/openapi.json', (_req: unknown, res: {
    json: (body: unknown) => void;
  }) => {
    res.json(document);
  });

  return document;
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureOpenApi(app);
  await app.listen(Number(process.env.API_PORT ?? 3000));
}

if (require.main === module) {
  void bootstrap();
}
