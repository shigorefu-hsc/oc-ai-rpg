import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { App } from './app';
import { DynamoStore } from './store';
import { BedrockAI } from './bedrock';
import { config } from './config';
import { serve } from './http';
declare const awslambda: {
  streamifyResponse: (
    fn: (event: APIGatewayProxyEventV2, stream: Writable) => Promise<void>,
  ) => unknown;
  HttpResponseStream: {
    from: (
      stream: Writable,
      metadata: { statusCode: number; headers: Record<string, string>; cookies?: string[] },
    ) => Writable;
  };
};
const cfg = config();
const app = new App(
  new DynamoStore({ auth: process.env.AUTH_TABLE!, data: process.env.DATA_TABLE! }),
  new BedrockAI(cfg.modelIds),
  cfg,
);
export const handler = awslambda.streamifyResponse(async (event, raw) => {
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers)) if (v) headers.set(k, v);
  if (event.cookies) headers.set('cookie', event.cookies.join('; '));
  const method = event.requestContext.http.method;
  const url =
    'https://' +
    event.requestContext.domainName +
    event.rawPath +
    (event.rawQueryString ? '?' + event.rawQueryString : '');
  const req = new Request(url, {
    method,
    headers,
    ...(!['GET', 'HEAD'].includes(method)
      ? { body: Buffer.from(event.body ?? '', event.isBase64Encoded ? 'base64' : 'utf8') }
      : {}),
  });
  const response = await serve(app, req, event.requestContext.http.sourceIp, '/var/task/client');
  const outHeaders = Object.fromEntries(response.headers);
  const cookies = outHeaders['set-cookie'] ? [outHeaders['set-cookie']] : undefined;
  delete outHeaders['set-cookie'];
  const stream = awslambda.HttpResponseStream.from(raw, {
    statusCode: response.status,
    headers: outHeaders,
    cookies,
  });
  if (response.body) await pipeline(Readable.fromWeb(response.body as never), stream);
  else stream.end();
});
