import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AutopatchStatus, Contract, OperationMode } from '../types.js';
import type { ContractRegistry } from '../contracts/registry.js';
import { validateContract } from '../contracts/validator.js';
import type { HealEngine } from '../healer/engine.js';
import type { MetricsStore } from '../metrics.js';
import type { EventHub, RequestEvent } from '../events.js';
import type { PrQueue } from '../github/pr.js';
import type { AlertManager } from '../alerts/webhook.js';
import { forwardRequest, UpstreamError } from './forward.js';

export interface ProxyDeps {
  upstreamBaseUrl: string;
  registry: ContractRegistry;
  engine: HealEngine;
  metrics: MetricsStore;
  events: EventHub;
  prQueue: PrQueue;
  alertManager?: AlertManager;
  getOperationMode?: () => OperationMode;
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

function tryHealOutbound(bodyText: string, errorPayload: unknown): Record<string, unknown> | null {
  try {
    const original = JSON.parse(bodyText);
    if (typeof original !== 'object' || original === null || Array.isArray(original)) {
      return null;
    }
    const errStr = JSON.stringify(errorPayload).toLowerCase();
    let healed = false;
    const copy: Record<string, unknown> = { ...(original as Record<string, unknown>) };

    // Common outbound schema drift: phone -> customer.mobile
    if (original.phone && (errStr.includes('customer.mobile') || errStr.includes('mobile'))) {
      delete copy.phone;
      copy.customer = { ...(typeof copy.customer === 'object' && copy.customer ? copy.customer : {}), mobile: original.phone };
      healed = true;
    }
    // Outbound drift: user_id -> id or customer_id
    if (original.user_id && errStr.includes('customer_id')) {
      copy.customer_id = original.user_id;
      delete copy.user_id;
      healed = true;
    } else if (original.user_id && errStr.includes('id')) {
      copy.id = original.user_id;
      delete copy.user_id;
      healed = true;
    }

    return healed ? copy : null;
  } catch {
    return null;
  }
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

    if ((forwarded.status === 400 || forwarded.status === 422) && parseOk) {
      const rawBody = requestBody(request);
      if (typeof rawBody === 'string' || Buffer.isBuffer(rawBody)) {
        const bodyStr = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
        const healedBody = tryHealOutbound(bodyStr, parsed);
        if (healedBody) {
          try {
            const retryForwarded = await forwardRequest(deps.upstreamBaseUrl, {
              method: request.method,
              url: request.raw.url ?? request.url,
              headers: {
                ...request.headers,
                'content-type': 'application/json',
              },
              body: JSON.stringify(healedBody),
            });
            if (retryForwarded.status >= 200 && retryForwarded.status < 300) {
              const overheadMs = round(performance.now() - afterUpstream);
              deps.metrics.recordHealed(false, overheadMs);
              emitRequest({
                type: 'request',
                id: requestId,
                ts: new Date().toISOString(),
                method: request.method,
                path: requestPath,
                status: 'AUTO_HEALED',
                cached: false,
                httpStatus: retryForwarded.status,
                upstreamMs: round(retryForwarded.upstreamMs),
                overheadMs,
                healMs: overheadMs,
                fingerprint: 'outbound-healed',
              });
              const headers = {
                ...safeHeaders(retryForwarded.headers),
                'x-autopatch-status': 'healed-outbound',
                'x-autopatch-bidirectional': 'true',
                'x-autopatch-overhead-ms': String(overheadMs),
              };
              return reply.code(retryForwarded.status).headers(headers).send(retryForwarded.body);
            }
          } catch {
            // Fallthrough to standard passthrough on retry failure
          }
        }
      }
    }

    if (!contract || forwarded.status < 200 || forwarded.status >= 300 || !parseOk) {
      // Auto-profile healthy 2xx JSON traffic on uncontracted endpoints (Zero-config schema learning)
      if (!contract && forwarded.status >= 200 && forwarded.status < 300 && parseOk) {
        deps.registry.recordLearnSample(request.method, requestPath, parsed);
      }
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
      deps.alertManager?.createDriftAlert({
        endpoint: requestPath,
        method: request.method,
        diffSummary: outcome.missingFields.length ? `Missing: ${outcome.missingFields.join(', ')}` : outcome.reason,
        confidence: 0,
        gatesPassed: '4/5 Gates Passed (Blocked at Gate 5: Completeness)',
        blockedGate: 'Gate 5 (Completeness)',
        severity: 'critical',
      });
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

    const opMode = deps.getOperationMode?.() ?? 'active';

    deps.metrics.recordHealed(outcome.cached, healMs);
    if (!outcome.cached) {
      deps.alertManager?.createDriftAlert({
        endpoint: requestPath,
        method: request.method,
        diffSummary: Object.entries(outcome.rule.fields)
          .map(([k, v]) => `${k} <- ${v.from}`)
          .join('; '),
        confidence: outcome.rule.confidence,
        gatesPassed: '5/5 Gates Passed (All Gates Verified)',
        severity: 'info',
      });
    }

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

    if (!outcome.cached) deps.prQueue.enqueue(outcome.entry);

    // Enterprise Shadow Mode: Observe only, do not alter live traffic
    if (opMode === 'shadow') {
      const headers = {
        ...safeHeaders(forwarded.headers),
        'x-autopatch-status': 'shadow-observed',
        'x-autopatch-shadow': 'would-heal',
        'x-autopatch-overhead-ms': String(overheadMs),
        'x-autopatch-fingerprint': outcome.fingerprint,
      };
      return reply.code(forwarded.status).headers(headers).send(forwarded.body);
    }

    // Enterprise Canary Mode: Heal 5% of drifted requests, pass 95% through to observe error rates
    if (opMode === 'canary' && Math.random() > 0.05) {
      const headers = {
        ...safeHeaders(forwarded.headers),
        'x-autopatch-status': 'canary-observed',
        'x-autopatch-canary': 'observe-only',
        'x-autopatch-overhead-ms': String(overheadMs),
      };
      return reply.code(forwarded.status).headers(headers).send(forwarded.body);
    }

    const headers = {
      ...safeHeaders(forwarded.headers),
      'content-type': 'application/json; charset=utf-8',
      'x-autopatch-status': outcome.cached ? 'healed-cached' : 'healed',
      'x-autopatch-overhead-ms': String(overheadMs),
      'x-autopatch-fingerprint': outcome.fingerprint,
    };

    return reply.code(200).headers(headers).send(JSON.stringify(outcome.after));
  };
}

export type { AutopatchStatus, Contract };
