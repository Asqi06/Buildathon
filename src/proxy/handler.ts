import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AutopatchStatus, Contract } from '../types.js';
import type { ContractRegistry } from '../contracts/registry.js';
import { validateContract } from '../contracts/validator.js';
import type { HealEngine } from '../healer/engine.js';
import type { MetricsStore } from '../metrics.js';
import type { EventHub, RequestEvent } from '../events.js';
import type { PrQueue } from '../github/pr.js';
import { forwardRequest, UpstreamError } from './forward.js';

export interface ProxyDeps {
  upstreamBaseUrl: string;
  registry: ContractRegistry;
  engine: HealEngine;
  metrics: MetricsStore;
  events: EventHub;
  prQueue: PrQueue;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isJsonContentType(contentType: string): boolean {
  return /application\/(?:[^;]+\+)?json/i.test(contentType) || /\bjson\b/i.test(contentType);
}

function safeHeaders(headers: Record<string, string>): Record<string, string> {
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase().startsWith('x-autopatch-')) continue;
    copy[name] = value;
  }
  return copy;
}

function requestBody(request: FastifyRequest): Buffer | string | undefined {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  if (request.rawBody && request.rawBody.length > 0) return request.rawBody;
  if (typeof request.body === 'string') return request.body;
  if (Buffer.isBuffer(request.body)) return request.body;
  if (request.body === undefined || request.body === null) return undefined;
  return JSON.stringify(request.body);
}

export function createProxyHandler(deps: ProxyDeps) {
  const emitMetrics = (): void => {
    deps.events.emit({
      type: 'metrics',
      ts: new Date().toISOString(),
      metrics: deps.metrics.snapshot(),
    });
  };

  const emitRequest = (event: RequestEvent): void => {
    deps.events.emit(event);
    emitMetrics();
  };

  return async function proxyHandler(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<FastifyReply> {
    const started = performance.now();
    const requestId = randomUUID();
    const requestPath = new URL(request.url, 'http://autopatch.local').pathname;

    let forwarded;
    try {
      forwarded = await forwardRequest(deps.upstreamBaseUrl, {
        method: request.method,
        url: request.raw.url ?? request.url,
        headers: request.headers,
        body: requestBody(request),
      });
    } catch (error) {
      const overheadMs = round(performance.now() - started);
      const message =
        error instanceof UpstreamError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      deps.metrics.recordUnrecoverable();
      emitRequest({
        type: 'request',
        id: requestId,
        ts: new Date().toISOString(),
        method: request.method,
        path: requestPath,
        status: 'UNRECOVERABLE',
        cached: false,
        httpStatus: 502,
        upstreamMs: 0,
        overheadMs,
        healMs: null,
        fingerprint: null,
        failure: {
          reason: 'UPSTREAM_UNREACHABLE',
          message,
          missingFields: [],
          diagnostics: [message],
        },
      });
      return reply
        .code(502)
        .header('x-autopatch-status', 'unrecoverable')
        .header('x-autopatch-overhead-ms', String(overheadMs))
        .header('content-type', 'application/json; charset=utf-8')
        .send({
          error: 'AUTOPATCH_UNRECOVERABLE',
          reason: 'UPSTREAM_UNREACHABLE',
          message,
          missingFields: [],
          signature: null,
          diagnostics: [message],
        });
    }

    const afterUpstream = performance.now();
    const contract = deps.registry.match(request.method, requestPath);
    const contentType = forwarded.headers['content-type'] ?? forwarded.contentType;

    let parsed: unknown = null;
    let parseOk = false;
    if (isJsonContentType(contentType) && forwarded.body.length > 0) {
      try {
        parsed = JSON.parse(forwarded.body.toString('utf8'));
        parseOk = true;
      } catch {
        parseOk = false;
      }
    }

    const passthrough = (): FastifyReply => {
      const overheadMs = round(performance.now() - afterUpstream);
      deps.metrics.recordPassthrough(overheadMs);
      emitRequest({
        type: 'request',
        id: requestId,
        ts: new Date().toISOString(),
        method: request.method,
        path: requestPath,
        status: 'PASSTHROUGH',
        cached: false,
        httpStatus: forwarded.status,
        upstreamMs: round(forwarded.upstreamMs),
        overheadMs,
        healMs: null,
        fingerprint: null,
      });
      const headers = {
        ...safeHeaders(forwarded.headers),
        'x-autopatch-status': 'passthrough',
        'x-autopatch-overhead-ms': String(overheadMs),
      };
      if (forwarded.status === 204 || forwarded.status === 304) {
        return reply.code(forwarded.status).headers(headers).send();
      }
      return reply.code(forwarded.status).headers(headers).send(forwarded.body);
    };

    if (!contract || forwarded.status < 200 || forwarded.status >= 300 || !parseOk) {
      return passthrough();
    }

    const validation = validateContract(parsed, contract);
    if (validation.valid) {
      const overheadMs = round(performance.now() - afterUpstream);
      deps.metrics.recordVerified(overheadMs);
      emitRequest({
        type: 'request',
        id: requestId,
        ts: new Date().toISOString(),
        method: request.method,
        path: requestPath,
        status: 'VERIFIED',
        cached: false,
        httpStatus: forwarded.status,
        upstreamMs: round(forwarded.upstreamMs),
        overheadMs,
        healMs: null,
        fingerprint: null,
      });
      const headers = {
        ...safeHeaders(forwarded.headers),
        'x-autopatch-status': 'verified',
        'x-autopatch-overhead-ms': String(overheadMs),
      };
      return reply.code(forwarded.status).headers(headers).send(forwarded.body);
    }

    const healStarted = performance.now();
    let outcome;
    try {
      outcome = await deps.engine.heal({
        method: request.method,
        endpoint: requestPath,
        contract,
        payload: parsed,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const healMs = round(performance.now() - healStarted);
      const overheadMs = round(performance.now() - afterUpstream);
      deps.metrics.recordUnrecoverable();
      emitRequest({
        type: 'request',
        id: requestId,
        ts: new Date().toISOString(),
        method: request.method,
        path: requestPath,
        status: 'UNRECOVERABLE',
        cached: false,
        httpStatus: 502,
        upstreamMs: round(forwarded.upstreamMs),
        overheadMs,
        healMs,
        fingerprint: null,
        failure: {
          reason: 'HEAL_ERROR',
          message,
          missingFields: [],
          diagnostics: [message],
        },
      });
      return reply
        .code(502)
        .header('x-autopatch-status', 'unrecoverable')
        .header('x-autopatch-overhead-ms', String(overheadMs))
        .header('content-type', 'application/json; charset=utf-8')
        .send({
          error: 'AUTOPATCH_UNRECOVERABLE',
          reason: 'HEAL_ERROR',
          message,
          missingFields: [],
          signature: null,
          diagnostics: [message],
        });
    }

    const healMs = round(performance.now() - healStarted);
    const overheadMs = round(performance.now() - afterUpstream);

    if (!outcome.ok) {
      deps.metrics.recordUnrecoverable();
      emitRequest({
        type: 'request',
        id: requestId,
        ts: new Date().toISOString(),
        method: request.method,
        path: requestPath,
        status: 'UNRECOVERABLE',
        cached: false,
        httpStatus: 502,
        upstreamMs: round(forwarded.upstreamMs),
        overheadMs,
        healMs,
        fingerprint: outcome.fingerprint,
        failure: {
          reason: outcome.reason,
          message: outcome.message,
          missingFields: outcome.missingFields,
          diagnostics: outcome.errors,
        },
      });
      return reply
        .code(502)
        .header('x-autopatch-status', 'unrecoverable')
        .header('x-autopatch-overhead-ms', String(overheadMs))
        .header('content-type', 'application/json; charset=utf-8')
        .send({
          error: 'AUTOPATCH_UNRECOVERABLE',
          reason: outcome.reason,
          message: outcome.message,
          missingFields: outcome.missingFields,
          signature: outcome.fingerprint,
          diagnostics: outcome.errors,
        });
    }

    deps.metrics.recordHealed(outcome.cached, healMs);
    deps.events.emit({
      type: 'heal',
      requestId,
      ts: new Date().toISOString(),
      endpoint: requestPath,
      method: request.method,
      fingerprint: outcome.fingerprint,
      cached: outcome.cached,
      before: parsed,
      sanitized: outcome.sanitized,
      after: outcome.after,
      rule: outcome.rule,
      reasoning: outcome.rule.reasoning,
      model: deps.engine.mapperModel,
      llmMode: deps.engine.mapperMode,
    });
    emitRequest({
      type: 'request',
      id: requestId,
      ts: new Date().toISOString(),
      method: request.method,
      path: requestPath,
      status: 'AUTO_HEALED',
      cached: outcome.cached,
      httpStatus: 200,
      upstreamMs: round(forwarded.upstreamMs),
      overheadMs,
      healMs,
      fingerprint: outcome.fingerprint,
    });

    const headers = {
      ...safeHeaders(forwarded.headers),
      'content-type': 'application/json; charset=utf-8',
      'x-autopatch-status': outcome.cached ? 'healed-cached' : 'healed',
      'x-autopatch-overhead-ms': String(overheadMs),
      'x-autopatch-fingerprint': outcome.fingerprint,
    };

    const response = reply.code(200).headers(headers).send(JSON.stringify(outcome.after));

    if (!outcome.cached) deps.prQueue.enqueue(outcome.entry);
    return response;
  };
}

export type { AutopatchStatus, Contract };
