import type { MappingRule } from '../types.js';
import { resolvePath } from './rule.js';

export interface MapperInput {
  endpoint: string;
  method: string;
  expectedSchema: Record<string, string>;
  structure: unknown;
  onAttempt?: () => void;
}

export interface LlmMapper {
  readonly mode: 'live' | 'mock';
  readonly model: string | null;
  map(input: MapperInput): Promise<MappingRule>;
}

const CANDIDATES: Record<string, string[]> = {
  user_id: ['user_id', 'userId', 'uid', 'customer_id', 'customer.uid', 'customer.id', 'user.id', 'id'],
  email: ['email', 'user_email', 'contact.email_addr', 'contact.email', 'customer.email', 'payer.email'],
  account_balance: ['account_balance', 'balance', 'amount', 'total', 'wallet.balance'],
  is_verified: ['is_verified', 'verified', 'isVerified', 'active', 'kyc_verified'],
  created_at: ['created_at', 'created', 'createdAt', 'timestamp', 'issued_at'],
};

const USER_ENTITY_WORDS = new Set(['user', 'userid', 'uid', 'customer', 'customerid', 'buyer', 'member']);
const RESOURCE_ENTITY_WORDS = new Set([
  'data',
  'dataid',
  'record',
  'recordid',
  'order',
  'orderid',
  'payment',
  'paymentid',
  'txn',
  'txnid',
  'charge',
  'chargeid',
  'transaction',
  'transactionid',
  'doc',
  'docid',
]);

const SYNONYM_GROUPS: Array<{ type?: string; words: string[] }> = [
  {
    type: 'string',
    words: [
      'id',
      'uid',
      'userid',
      'customerid',
      'accountid',
      'dataid',
      'recordid',
      'orderid',
      'paymentid',
      'txnid',
      'chargeid',
      'key',
      'ref',
      'transactionid',
    ],
  },
  { type: 'string', words: ['email', 'mail', 'emailaddr', 'emailaddress', 'useremail', 'contactemail', 'customeremail', 'receiptemail'] },
  { type: 'number', words: ['balance', 'accountbalance', 'amount', 'amountinr', 'amountusd', 'total', 'totalprice', 'totalamount', 'price', 'subtotal', 'netamount', 'value', 'paise', 'cents'] },
  { type: 'boolean', words: ['verified', 'isverified', 'active', 'isactive', 'confirmed', 'isconfirmed', 'enabled', 'captured', 'iscaptured', 'paid', 'ispaid', 'valid', 'statuspaid'] },
  { type: 'iso_datetime', words: ['createdat', 'created', 'capturedat', 'timestamp', 'createdtimestamp', 'date', 'issuedat', 'time', 'updatedat', 'paidat'] },
  { type: 'string', words: ['name', 'fullname', 'displayname', 'username', 'customername', 'title', 'itemname'] },
  { type: 'string', words: ['phone', 'mobile', 'buyerphone', 'customermobile', 'phonenumber', 'contactnumber', 'msisdn', 'tel'] },
  { type: 'string', words: ['currency', 'curr', 'currencycode', 'isocurrency'] },
  { type: 'string', words: ['status', 'state', 'orderstatus', 'paymentstatus'] },
];

function normalizeToken(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function splitWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 1 && w !== 'is' && w !== 'at');
}

function tokensMatchSemantically(
  targetKey: string,
  candidateLeaf: string,
  candidateFullPath: string,
  expectedType: string,
  candidateClass: string,
): number {
  const tNorm = normalizeToken(targetKey);
  const cNorm = normalizeToken(candidateLeaf);
  const pNorm = normalizeToken(candidateFullPath);

  if (tNorm === cNorm) return 100;
  if (tNorm === pNorm) return 96;

  const targetWords = [tNorm, ...splitWords(targetKey)];
  const candWords = [cNorm, ...splitWords(candidateLeaf), ...splitWords(candidateFullPath)];

  // Entity domain disambiguation: prevent user_id from stealing data_id/order_id and vice versa
  const targetIsUser = targetWords.some((w) => USER_ENTITY_WORDS.has(w));
  const targetIsResource = targetWords.some((w) => RESOURCE_ENTITY_WORDS.has(w));
  const candIsUser = candWords.some((w) => USER_ENTITY_WORDS.has(w));
  const candIsResource = candWords.some((w) => RESOURCE_ENTITY_WORDS.has(w));

  if (targetIsUser && candIsResource && !candIsUser) return 0;
  if (targetIsResource && candIsUser && !candIsResource) return 0;

  let domainBonus = 0;
  if ((targetIsUser && candIsUser) || (targetIsResource && candIsResource)) {
    domainBonus = 10;
  }

  // Type compatibility bonus
  let typeBonus = 0;
  if (expectedType === 'iso_datetime') {
    if (candidateClass.includes('epoch') || candidateClass.includes('iso_datetime')) typeBonus += 15;
  } else if (expectedType === 'number') {
    if (candidateClass.includes('number') || candidateClass.includes('numeric')) typeBonus += 10;
  }

  if ((cNorm.endsWith(tNorm) || tNorm.endsWith(cNorm)) && cNorm !== 'id') {
    return 88 + domainBonus + typeBonus;
  }
  if (pNorm.endsWith(tNorm)) return 86 + domainBonus + typeBonus;

  for (const group of SYNONYM_GROUPS) {
    if (group.type && group.type !== expectedType && expectedType === 'iso_datetime') continue;
    if (group.type === 'iso_datetime' && expectedType !== 'iso_datetime') continue;
    const targetInGroup = targetWords.some((w) => group.words.includes(w));
    const candInGroup = candWords.some((w) => group.words.includes(w));
    if (targetInGroup && candInGroup) {
      const sameTypeBonus = group.type === expectedType ? 4 : 0;
      return 80 + domainBonus + sameTypeBonus + typeBonus;
    }
  }
  return 0;
}

function collectLeafPaths(node: unknown, prefix = '', out: Array<{ path: string; leaf: string; cls: string }> = []) {
  if (node === null || node === undefined) return out;
  if (typeof node === 'string') {
    const parts = prefix.split('.');
    const leaf = (parts[parts.length - 1] ?? prefix).replace(/\[\d+\]/g, '');
    out.push({ path: prefix, leaf, cls: node });
    return out;
  }
  if (Array.isArray(node)) {
    if (node.length > 0) {
      collectLeafPaths(node[0], `${prefix}[0]`, out);
    }
    return out;
  }
  if (typeof node === 'object') {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      const next = prefix ? `${prefix}.${k}` : k;
      collectLeafPaths(v, next, out);
    }
  }
  return out;
}

function unwrapPrefix(structure: unknown): string | null {
  if (typeof structure !== 'object' || structure === null) return null;
  const record = structure as Record<string, unknown>;
  for (const key of ['data', 'items', 'results', 'records']) {
    if (Array.isArray(record[key]) && (record[key] as unknown[]).length > 0) {
      return `${key}[0].`;
    }
  }
  return null;
}

function sourceCandidates(field: string, prefix: string): string[] {
  const extra = [`${field}`, ...(CANDIDATES[field] ?? [])];
  return [...new Set(extra)].map((path) => `${prefix}${path}`);
}

function classOf(structure: unknown, path: string): string | null {
  const resolved = resolvePath(structure, path);
  if (!resolved.found) return null;
  return typeof resolved.value === 'string' ? resolved.value : null;
}

export class MockMapper implements LlmMapper {
  readonly mode = 'mock' as const;
  readonly model = 'mock-mapper-v1';

  async map(input: MapperInput): Promise<MappingRule> {
    input.onAttempt?.();
    const prefix = unwrapPrefix(input.structure) ?? '';
    const unwrapKey = prefix.endsWith('.') ? prefix.slice(0, -1) : '';
    const scoped = prefix === '' ? input.structure : resolvePath(input.structure, unwrapKey).value;
    const allLeaves = collectLeafPaths(input.structure);
    const usedPaths = new Set<string>();

    const fields: MappingRule['fields'] = {};
    const unmappable: string[] = [];
    let missing = 0;

    for (const field of Object.keys(input.expectedSchema)) {
      const expectedType = input.expectedSchema[field] ?? 'string';
      let source: string | null = null;
      let sourceClass: string | null = null;

      for (const candidate of sourceCandidates(field, '')) {
        const fullPath = `${prefix}${candidate}`;
        if (usedPaths.has(fullPath)) continue;
        const foundClass = classOf(scoped, candidate);
        if (foundClass !== null) {
          source = fullPath;
          sourceClass = foundClass;
          usedPaths.add(source);
          break;
        }
      }

      // Universal semantic AST fallback for arbitrary user schemas
      if (source === null) {
        let bestScore = 0;
        let bestLeaf: { path: string; leaf: string; cls: string } | null = null;
        for (const item of allLeaves) {
          if (usedPaths.has(item.path)) continue;
          const score = tokensMatchSemantically(field, item.leaf, item.path, expectedType, item.cls);
          if (score > bestScore) {
            bestScore = score;
            bestLeaf = item;
          }
        }
        if (bestLeaf && bestScore >= 80) {
          source = bestLeaf.path;
          sourceClass = bestLeaf.cls;
          usedPaths.add(source);
        }
      }

      if (source === null) {
        missing += 1;
        unmappable.push(field);
        fields[field] = { from: null, coerce: 'none' };
        continue;
      }

      let coerce: MappingRule['fields'][string]['coerce'] = 'none';
      if (expectedType === 'number') {
        coerce = sourceClass?.startsWith('string') ? 'number' : 'none';
      } else if (expectedType === 'boolean') {
        coerce = sourceClass?.startsWith('string') || sourceClass?.startsWith('number')
          ? 'boolean'
          : 'none';
      } else if (expectedType === 'iso_datetime') {
        if (sourceClass?.startsWith('number') || sourceClass === 'string:numeric') {
          coerce = 'iso_datetime';
        } else if (sourceClass === 'string') {
          coerce = 'iso_datetime';
        } else {
          coerce = 'none';
        }
      } else if (expectedType === 'string') {
        coerce = sourceClass?.startsWith('string') ? 'none' : 'string';
      }

      fields[field] = { from: source, coerce };
    }

    return {
      fields,
      unmappable,
      confidence: missing === 0 ? 0.95 : 0.35,
      reasoning:
        missing === 0
          ? `Mapped every baseline field from the observed structure${prefix ? ' inside data[0]' : ''}.`
          : `No source found for ${missing} baseline field${missing === 1 ? '' : 's'}; reported them as unmappable.`,
    };
  }
}
