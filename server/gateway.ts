import type { APIGatewayProxyEvent, APIGatewayProxyEventV2 } from 'aws-lambda';
export type GatewayEvent = APIGatewayProxyEvent | APIGatewayProxyEventV2;
export function gatewayRequest(event: GatewayEvent) {
  const v2 = 'version' in event && event.version === '2.0';
  const headers = new Headers();
  for (const [k, v] of Object.entries(event.headers ?? {})) if (v) headers.set(k, v);
  let method: string,
    path: string,
    query: string,
    ip: string,
    basePath = '';
  if (v2) {
    const e = event as APIGatewayProxyEventV2;
    if (e.cookies) headers.set('cookie', e.cookies.join('; '));
    method = e.requestContext.http.method;
    path = e.rawPath;
    query = e.rawQueryString;
    ip = e.requestContext.http.sourceIp;
  } else {
    const e = event as APIGatewayProxyEvent;
    for (const [k, v] of Object.entries(e.multiValueHeaders ?? {}))
      if (v) headers.set(k, v.join(k.toLowerCase() === 'cookie' ? '; ' : ', '));
    method = e.httpMethod;
    path = e.path || '/';
    ip = e.requestContext.identity.sourceIp;
    const params = new URLSearchParams();
    for (const [k, values] of Object.entries(e.multiValueQueryStringParameters ?? {}))
      for (const v of values ?? []) params.append(k, v);
    if (!e.multiValueQueryStringParameters)
      for (const [k, v] of Object.entries(e.queryStringParameters ?? {}))
        if (v !== undefined) params.set(k, v);
    query = params.toString();
    if (e.requestContext.domainName?.endsWith('.execute-api.ap-northeast-1.amazonaws.com')) {
      if (!/^[A-Za-z0-9_-]+$/.test(e.requestContext.stage)) throw new Error('INVALID_STAGE');
      basePath = '/' + e.requestContext.stage;
    }
  }
  const url = 'https://' + event.requestContext.domainName + path + (query ? '?' + query : '');
  return {
    req: new Request(url, {
      method,
      headers,
      ...(!['GET', 'HEAD'].includes(method)
        ? { body: Buffer.from(event.body ?? '', event.isBase64Encoded ? 'base64' : 'utf8') }
        : {}),
    }),
    ip,
    basePath,
    v2,
  };
}
