const STRIPPED_REQUEST_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
]);

const STRIPPED_RESPONSE_HEADERS = new Set([
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'connection',
  'keep-alive',
  'upgrade',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
]);

export interface ForwardInput {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer | string | undefined;
}

export interface ForwardResult {
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  upstreamMs: number;
  contentType: string;
}

export class UpstreamError extends Error {
  readonly reason = 'UPSTREAM_UNREACHABLE';

  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export async function forwardRequest(
  baseUrl: string,
  input: ForwardInput,
): Promise<ForwardResult> {
  const headers = new Headers();
  for (const [name, value] of Object.entries(input.headers)) {
    if (value === undefined) continue;
    if (STRIPPED_REQUEST_HEADERS.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else {
      headers.set(name, value);
    }
  }

  const started = performance.now();
  let response: Response;
  try {
    const requestBody =
      input.method === 'GET' || input.method === 'HEAD'
        ? undefined
        : (input.body as unknown as BodyInit | undefined);

    response = await fetch(`${baseUrl}${input.url}`, {
      method: input.method,
      headers,
      body: requestBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new UpstreamError(`Upstream request failed: ${message}`);
  }

  const body = Buffer.from(await response.arrayBuffer());
  const upstreamMs = performance.now() - started;

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, name) => {
    if (STRIPPED_RESPONSE_HEADERS.has(name.toLowerCase())) return;
    responseHeaders[name.toLowerCase()] = value;
  });

  return {
    status: response.status,
    headers: responseHeaders,
    body,
    upstreamMs,
    contentType: response.headers.get('content-type') ?? '',
  };
}
