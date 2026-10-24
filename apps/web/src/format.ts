import type { RunStatus, Verdict } from '@evals/shared';

export const percent = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`;

/** A difference in pass rates, in percentage points with an explicit sign. */
export const points = (x: number | null | undefined, digits = 0) => {
  if (x === null || x === undefined) return '—';
  const value = Number((x * 100).toFixed(digits));
  return `${value > 0 ? '+' : ''}${value} pts`;
};

export const money = (x: number | null | undefined): string => {
  if (x === null || x === undefined) return '—';
  if (x < 0) return `−${money(-x)}`;
  return x > 0 && x < 0.01 ? '<$0.01' : `$${x.toFixed(2)}`;
};

export const seconds = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '—';
  const s = (ms / 1000).toFixed(1);
  return `${s === '-0.0' ? '0.0' : s}s`;
};

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

export const VERDICT: Record<
  Verdict,
  { label: string; tone: 'good' | 'bad' | 'neutral' | 'warn' }
> = {
  better: { label: 'B is better', tone: 'good' },
  worse: { label: 'B is worse', tone: 'bad' },
  no_meaningful_difference: { label: 'No meaningful difference', tone: 'neutral' },
  inconclusive: { label: 'Inconclusive', tone: 'warn' },
  incomplete: { label: 'Incomplete', tone: 'warn' },
};

export const RUN_STATUS: Record<RunStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  scored: 'Scored',
  error: 'Error',
  cancelled: 'Cancelled',
};

/** Plain words for the judge's labels. */
export const ISSUE_TEXT: Record<string, string> = {
  writes_to_operator: 'Writes to an operator, not the customer',
  not_sms_style: "Doesn't read like a text message",
  unbacked_claim: "Says something the CRM doesn't back up",
  reasked_known_info: 'Asks again for something already given',
  ignored_question: "Ignores the customer's question",
  booked_without_clear_yes: 'Books without a clear yes',
};

export const label = (value: string) => value.replaceAll('_', ' ');
