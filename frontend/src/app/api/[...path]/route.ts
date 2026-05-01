import { NextRequest, NextResponse } from 'next/server';

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || '';
const EDGE_TOKEN = process.env.EDGE_TOKEN || '';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function proxy(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  if (!BACKEND_ORIGIN || !EDGE_TOKEN) {
    console.error('[api-proxy] Missing BACKEND_ORIGIN or EDGE_TOKEN env');
    return NextResponse.json(
      { error: 'API proxy is not configured' },
      { status: 500 }
    );
  }

  const path = params.path.join('/');
  const search = req.nextUrl.search;
  const targetUrl = `${BACKEND_ORIGIN}/api/${path}${search}`;

  const headers = new Headers(req.headers);
  headers.set('X-Edge-Token', EDGE_TOKEN);
  headers.delete('host');
  headers.delete('content-length');
  headers.delete('connection');
  headers.delete('accept-encoding');
  headers.delete('transfer-encoding');
  headers.delete('keep-alive');
  headers.delete('te');
  headers.delete('upgrade');

  const method = req.method.toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);

  try {
    const body = hasBody ? await req.arrayBuffer() : undefined;

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
