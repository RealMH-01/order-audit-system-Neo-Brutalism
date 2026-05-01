import { NextRequest, NextResponse } from 'next/server';

const BACKEND_ORIGIN = process.env.BACKEND_ORIGIN || '';
const EDGE_TOKEN = process.env.EDGE_TOKEN || '';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

async function proxy(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  // 配置缺失时直接 500，避免出现难以排查的 403
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

  const method = req.method.toUpperCase();
  const hasBody = !['GET', 'HEAD'].includes(method);

  const init: RequestInit & { duplex?: 'half' } = {
    method,
    headers,
    body: hasBody ? req.body : undefined,
    redirect: 'manual',
  };

  if (hasBody) {
    init.duplex = 'half';
  }

  try {
    const upstream = await fetch(targetUrl, init);
    const respHeaders = new Headers(upstream.headers);
    respHeaders.delete('content-encoding');
    respHeaders.delete('transfer-encoding');
    respHeaders.delete('connection');

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
