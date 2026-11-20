import type { ChaosMode } from '../types.js';

export const CHAOS_MODES = [
  'none',
  'rename',
  'nest',
  'type_mismatch',
  'array_wrap',
  'date_shift',
  'combo_v2',
  'field_deleted',
] as const satisfies readonly ChaosMode[];

export const BASELINE_PAYLOAD = Object.freeze({
  user_id: 'usr_99',
  email: 'dev@acme.io',
  account_balance: 450.5,
  is_verified: true,
  created_at: '2026-11-14T09:30:00Z',
});

export const CHAOS_LABELS: Record<ChaosMode, { name: string; description: string }> = {
  none: {
    name: 'Baseline',
    description: 'The upstream returns the contract shape. No drift.',
  },
  rename: {
    name: 'Rename fields',
    description: 'user_id becomes id, email becomes user_email.',
  },
  nest: {
    name: 'Nest a field',
    description: 'email moves into contact.email_addr.',
  },
  type_mismatch: {
    name: 'Change types',
    description: 'Balance becomes a string; the boolean becomes 1.',
  },
  array_wrap: {
    name: 'Wrap in array',
    description: 'The whole payload moves into data[0].',
  },
  date_shift: {
    name: 'Shift date format',
    description: 'created_at becomes epoch seconds.',
  },
  combo_v2: {
    name: 'Breaking change',
    description: 'Renames, nesting, types and dates change at once.',
  },
  field_deleted: {
    name: 'Delete a field',
    description: 'email disappears. There is nothing to map to.',
  },
};

export function payloadFor(mode: ChaosMode): unknown {
  const baseline = structuredClone(BASELINE_PAYLOAD);
  const epochSeconds = Math.floor(Date.parse(BASELINE_PAYLOAD.created_at) / 1000);

  switch (mode) {
    case 'none':
      return baseline;
    case 'rename':
      return {
        id: baseline.user_id,
        user_email: baseline.email,
        account_balance: baseline.account_balance,
        is_verified: baseline.is_verified,
        created_at: baseline.created_at,
      };
    case 'nest':
      return {
        user_id: baseline.user_id,
        contact: { email_addr: baseline.email },
        account_balance: baseline.account_balance,
        is_verified: baseline.is_verified,
        created_at: baseline.created_at,
      };
    case 'type_mismatch':
      return {
        ...baseline,
        account_balance: '450.50',
        is_verified: 1,
      };
    case 'array_wrap':
      return { data: [baseline] };
    case 'date_shift':
      return { ...baseline, created_at: epochSeconds };
    case 'combo_v2':
      return {
        id: baseline.user_id,
        contact: { email_addr: baseline.email },
        balance: '450.50',
        verified: 1,
        created: epochSeconds,
      };
    case 'field_deleted': {
      const copy = { ...baseline } as Record<string, unknown>;
      delete copy.email;
      return copy;
    }
    default: {
      const exhaustive: never = mode;
      throw new Error(`Unknown chaos mode: ${String(exhaustive)}`);
    }
  }
}
