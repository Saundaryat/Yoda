import type { Comparison, RunStatus, Verdict } from '@evals/shared';

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

/** Report the observed pass-rate result separately from evidence about repeatability. */
export function observedResult(comparison: Comparison): {
  label: string;
  headline: string;
  tone: 'good' | 'bad' | 'neutral' | 'warn';
} {
  if (
    comparison.verdict === 'incomplete' ||
    comparison.complete === false ||
    !comparison.pairedTasks
  ) {
    return {
      label: 'Incomplete',
      headline:
        comparison.incompleteReason ??
        'Some planned repetitions or required judgments are missing.',
      tone: 'warn',
    };
  }
  if (Math.abs(comparison.passRateA - comparison.passRateB) < 1e-12) {
    return {
      label: 'Same pass rate',
      headline: `A and B had the same pass rate in this test: ${percent(comparison.passRateA)}.`,
      tone: 'neutral',
    };
  }
  const higher = comparison.passRateB > comparison.passRateA ? 'B' : 'A';
  const rates =
    higher === 'B'
      ? [comparison.passRateB, comparison.passRateA]
      : [comparison.passRateA, comparison.passRateB];
  return {
    label: `${higher} scored higher`,
    headline: `${higher} scored higher in this test: ${percent(rates[0])} vs ${percent(rates[1])}.`,
    tone:
      comparison.verdict === 'better' ? 'good' : comparison.verdict === 'worse' ? 'bad' : 'neutral',
  };
}

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
