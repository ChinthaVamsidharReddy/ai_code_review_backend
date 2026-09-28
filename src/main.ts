import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // JWT_SECRET doubles as the encryption key for stored AI provider API
  // keys (see common/crypto.util.ts). If it isn't set explicitly, the app
  // falls back to a hardcoded dev value — which works, but ONLY as long as
  // that fallback stays constant across restarts. The moment a real
  // JWT_SECRET is added to .env (or the fallback string ever changes),
  // every previously-saved AI provider key becomes undecryptable (AES-GCM
  // correctly refuses to decrypt under the wrong key) and every AI feature
  // fails until those providers are removed and re-added. Warn loudly at
  // startup instead of letting that surface later as a confusing crypto
  // error deep in a request.
  if (!process.env.JWT_SECRET) {
    Logger.warn(
      'JWT_SECRET is not set — using an insecure default. This ALSO encrypts stored AI provider API keys: ' +
        'if you set a real JWT_SECRET later, every previously-saved AI provider will need to be removed and ' +
        're-added. Set JWT_SECRET in backend/.env now to avoid that.',
      'Bootstrap',
    );
  }

  app.use(helmet());
  app.enableCors({ origin: config.get<string>('corsOrigin'), credentials: true });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip properties not declared in the DTO
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = config.get<number>('port') as number;
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api`, 'Bootstrap');
}
bootstrap();
