import { NextRequest, NextResponse } from 'next/server';

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || '';
const EDGE_TOKEN = process.env.EDGE_TOKEN || '';
const JSON_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
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
  if (!BACKEND_ORIGIN) {
    console.error('[api-proxy] Missing BACKEND_ORIGIN env');
    return NextResponse.json(
      { error: 'API proxy is not configured' },
      { status: 500 }
    );
  }

  const path = params.path.join('/');
  const search = req.nextUrl.search;
  const targetUrl = `${BACKEND_ORIGIN}/api/${path}${search}`;

  const method = req.method.toUpperCase();
  const headers = buildProxyHeaders(req);

  try {
    const body = await buildProxyBody(req, method, headers);

    const upstream = await fetch(targetUrl, {
      method,
      headers,
      body,
      redirect: 'manual',
    });

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
    console.error('[api-proxy] upstream error:', err);
    return NextResponse.json(
      { error: 'Upstream service unreachable', detail: String(err) },
      { status: 502 }
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
