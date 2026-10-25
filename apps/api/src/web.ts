import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Shared by production and the offline browser-test server. */
export function configureWeb(app: NestExpressApplication, webDist: string | undefined): void {
  if (!webDist) return;
  const indexHtml = readFileSync(resolve(webDist, 'index.html'), 'utf8');
  const server = app.getHttpAdapter().getInstance();
  app.useStaticAssets(webDist);
  // The client router owns non-API paths, including directly opened nested URLs.
  server.get(/^(?!\/api(?:\/|$)).*/, (_request: Request, response: Response) => {
    response.type('html').send(indexHtml);
  });
}
