import { NextRequest, NextResponse } from 'next/server';

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || '';
const EDGE_TOKEN = process.env.EDGE_TOKEN || '';
const JSON_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
const FETCH_TIMEOUT_MS = 25000;
const HOP_BY_HOP_HEADERS = [
  'host',
  'content-length',
  'connection',
  'accept-encoding',
  'expect',
  'transfer-encoding',
  'keep-alive',
  'te',
  'upgrade',
];

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function buildProxyHeaders(req: NextRequest) {
  const headers = new Headers(req.headers);

  for (const header of HOP_BY_HOP_HEADERS) {
    headers.delete(header);
  }

  if (EDGE_TOKEN) {
    headers.set('X-Edge-Token', EDGE_TOKEN);
  }

  return headers;
}

function requestHasBody(req: NextRequest, method: string) {
  if (method === 'GET' || method === 'HEAD') {
    return false;
  }

  const contentLength = req.headers.get('content-length');
  const transferEncoding = req.headers.get('transfer-encoding');
  const parsedContentLength =
    contentLength === null ? 0 : Number.parseInt(contentLength, 10);

  return (
    (Number.isFinite(parsedContentLength) && parsedContentLength > 0) ||
    Boolean(transferEncoding)
  );
}

function isMultipartRequest(req: NextRequest) {
  const contentType = req.headers.get('content-type')?.toLowerCase() || '';

  return contentType.includes('multipart/form-data');
}

function shouldSerializeJsonBody(req: NextRequest, method: string) {
  return JSON_METHODS.has(method) && !isMultipartRequest(req);
}

async function buildProxyBody(
  req: NextRequest,
  method: string,
  headers: Headers
) {
  if (!requestHasBody(req, method)) {
    return undefined;
  }

  if (shouldSerializeJsonBody(req, method)) {
    headers.set('Content-Type', 'application/json');
    return JSON.stringify(await req.json());
  }

  return await req.arrayBuffer();
}

async function proxy(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  try {
    if (!BACKEND_ORIGIN) {
      console.error('[api-proxy] Missing BACKEND_ORIGIN env');
      return NextResponse.json(
        { error: 'missing_env', missing: 'BACKEND_ORIGIN' },
        { status: 500 }
      );
    }

    const path = params.path.join('/');
    const search = req.nextUrl.search;
    const targetUrl = `${BACKEND_ORIGIN}/api/${path}${search}`;

    const method = req.method.toUpperCase();
    const headers = buildProxyHeaders(req);
    const body = await buildProxyBody(req, method, headers);

    console.log('[api-proxy] forwarding request', {
      target_url: targetUrl,
      request_method: method,
      has_body: body !== undefined,
      has_authorization: headers.has('authorization'),
    });

    const controller = new AbortController();
    let didTimeout = false;
    const timeout = setTimeout(() => {
      didTimeout = true;
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    let upstream: Response;

    try {
      upstream = await fetch(targetUrl, {
        method,
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch (err) {
      if (didTimeout) {
        return NextResponse.json(
          {
            error: 'backend_timeout',
            elapsed_ms: FETCH_TIMEOUT_MS,
            target_url: targetUrl,
          },
          { status: 504 }
        );
      }

      throw err;
    } finally {
      clearTimeout(timeout);
    }

    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete('content-encoding');
    respHeaders.delete('transfer-encoding');
    respHeaders.delete('connection');

    if (method === 'HEAD' || upstream.status === 204 || upstream.status === 304) {
      return new NextResponse(null, {
        status: upstream.status,
        statusText: upstream.statusText,
        headers: respHeaders,
      });
    }

    return new NextResponse(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: respHeaders,
    });
  } catch (err) {
    const error = err as Error & { cause?: unknown };

    console.error('[api-proxy] proxy error:', err);
    return NextResponse.json(
      {
        error: 'proxy_error',
        message: error.message,
        name: error.name,
        stack: error.stack?.split('\n').slice(0, 5),
        cause: String(error.cause || ''),
        backend_origin: process.env.BACKEND_ORIGIN || 'NOT_SET',
        has_edge_token: !!process.env.EDGE_TOKEN,
        request_path: params.path,
        request_method: req.method,
      },
      { status: 500 }
    );
  }
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
export const HEAD = proxy;
export const OPTIONS = proxy;
