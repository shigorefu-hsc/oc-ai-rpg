import test from 'node:test';
import assert from 'node:assert/strict';
import { gatewayRequest } from '../server/gateway';
test('REST stage and custom domain preserve method, cookies, body, query and trusted origin', async () => {
  const event: any = {
    httpMethod: 'POST',
    path: '/api/works',
    headers: {
      host: 'untrusted.example',
      origin: 'https://abc.execute-api.ap-northeast-1.amazonaws.com',
    },
    multiValueHeaders: { Cookie: ['__Host-rpg=token'] },
    multiValueQueryStringParameters: { cursor: ['a+b/=='] },
    body: Buffer.from('{"hello":1}').toString('base64'),
    isBase64Encoded: true,
    requestContext: {
      domainName: 'abc.execute-api.ap-northeast-1.amazonaws.com',
      stage: 'demo',
      identity: { sourceIp: '192.0.2.1' },
    },
  };
  let v = gatewayRequest(event);
  assert.equal(v.basePath, '/demo');
  assert.equal(v.req.headers.get('cookie'), '__Host-rpg=token');
  assert.equal(new URL(v.req.url).searchParams.get('cursor'), 'a+b/==');
  assert.equal(new URL(v.req.url).origin, 'https://abc.execute-api.ap-northeast-1.amazonaws.com');
  assert.equal(await v.req.text(), '{"hello":1}');
  event.requestContext.domainName = 'ai-taiken.shigorefu.com';
  v = gatewayRequest(event);
  assert.equal(v.basePath, '');
});
test('Function URL v2 keeps root path and cookie behavior', () => {
  const v = gatewayRequest({
    version: '2.0',
    headers: {},
    cookies: ['a=1', 'b=2'],
    rawPath: '/api/bootstrap',
    rawQueryString: 'x=1',
    requestContext: {
      domainName: 'xyz.lambda-url.ap-northeast-1.on.aws',
      http: { method: 'GET', sourceIp: '192.0.2.1' },
    },
  } as any);
  assert.equal(v.basePath, '');
  assert.equal(v.req.headers.get('cookie'), 'a=1; b=2');
  assert.equal(new URL(v.req.url).pathname, '/api/bootstrap');
});
