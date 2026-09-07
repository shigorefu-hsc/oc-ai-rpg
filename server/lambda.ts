import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { gatewayRequest, type GatewayEvent } from './gateway';
import { App } from './app';
import { DynamoStore } from './store';
import { BedrockAI } from './bedrock';
import { config } from './config';
import { serve } from './http';
declare const awslambda: {
  streamifyResponse: (fn: (event: GatewayEvent, stream: Writable) => Promise<void>) => unknown;
  HttpResponseStream: {
    from: (
      stream: Writable,
      metadata: {
        statusCode: number;
        headers: Record<string, string>;
        cookies?: string[];
        multiValueHeaders?: Record<string, string[]>;
      },
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
  const { req, ip, basePath, v2 } = gatewayRequest(event);
  const response = await serve(app, req, ip, '/var/task/client', basePath);
  const outHeaders = Object.fromEntries(response.headers);
  const cookies = outHeaders['set-cookie'] ? [outHeaders['set-cookie']] : undefined;
  delete outHeaders['set-cookie'];
  const stream = awslambda.HttpResponseStream.from(raw, {
    statusCode: response.status,
    headers: outHeaders,
    ...(v2 ? { cookies } : { multiValueHeaders: cookies ? { 'Set-Cookie': cookies } : undefined }),
  });
  if (response.body) await pipeline(Readable.fromWeb(response.body as never), stream);
  else stream.end();
});
