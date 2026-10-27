import type { GradingCallUsage } from '../scoring/grading-usage.js';
import {
  versionLetter,
  type CostBreakdown,
  type CostBreakdownRow,
  type JudgeReport,
} from '@evals/shared';

interface CostRun {
  configId: string;
  attempts: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  costStatus: string | null;
  leadCostUsd: number | null;
  judgeCostUsd: number | null;
  gradingUsage?: GradingCallUsage[] | null;
  context: unknown;
  judge: unknown;
}
interface CostContext {
  model?: string;
  lead?: { model: string; calls: number; inputTokens: number; outputTokens: number };
  rescoring?: { mode?: string };
}
const descriptions = {
  'Agent A': 'The baseline assistant replies to customers and uses CRM tools.',
  'Agent B': 'The candidate assistant replies to customers and uses CRM tools.',
  'Agent C': 'Another candidate assistant replies to customers and uses CRM tools.',
  'Agent D': 'Another candidate assistant replies to customers and uses CRM tools.',
  'Agent E': 'Another candidate assistant replies to customers and uses CRM tools.',
  'Agent F': 'Another candidate assistant replies to customers and uses CRM tools.',
  Customer: 'Generates customer follow-up messages from the scenario.',
  'Claude judge': 'Checks the conversation against the task and clinic rules.',
  'Evidence reviewer': 'Double-checks claims flagged as unsupported.',
  Jev: 'Classifies unsupported claims as minor or serious.',
  Grading: 'Saved grading estimate whose individual components are unavailable.',
};

/** Agent A is the baseline; B, C… are candidates in experiment order. */
function agentLabel(
  experiment: { baselineConfigId: string; configIds?: string[] | null },
  configId: string,
): keyof typeof descriptions {
  const index = (experiment.configIds ?? [experiment.baselineConfigId]).indexOf(configId);
  return `Agent ${versionLetter(index < 0 ? 1 : index)}` as keyof typeof descriptions;
}

export function costBreakdown(
  experiment: { id: string; name: string; baselineConfigId: string; configIds?: string[] | null },
  runs: CostRun[],
): CostBreakdown {
  const rows = new Map<string, CostBreakdownRow>();
  const add = (
    label: keyof typeof descriptions,
    model: string | undefined,
    cost: number | null,
    used: boolean,
    unknown = cost === null,
  ) => {
    if (!used) return;
    const id = `${label}:${model ?? 'unknown'}`;
    const row = rows.get(id) ?? {
      id,
      label,
      model: model ?? null,
      description: descriptions[label],
      runs: 0,
      estimatedCostUsd: 0,
      unknownEstimates: 0,
    };
    row.runs++;
    if (unknown) row.unknownEstimates++;
    row.estimatedCostUsd += cost ?? 0;
    rows.set(id, row);
  };
  for (const run of runs) {
    const context = (run.context ?? {}) as CostContext;
    const judge = run.judge as JudgeReport | null;
    // Replays retain old conversations and judge metadata. Charge only new work.
    if (!context.rescoring) {
      add(
        agentLabel(experiment, run.configId),
        context.model,
        run.costUsd,
        (run.costUsd ?? 0) > 0 ||
          (run.inputTokens ?? 0) + (run.outputTokens ?? 0) > 0 ||
          run.costStatus === 'unknown',
      );
      add(
        'Customer',
        context.lead?.model,
        run.leadCostUsd,
        (context.lead?.calls ?? 0) > 0 || (run.leadCostUsd ?? 0) > 0,
      );
    }
    if (context.rescoring?.mode === 'score-only') continue;
    if (run.gradingUsage?.length) {
      const labels = {
        judge: 'Claude judge',
        review: 'Evidence reviewer',
        classifier: 'Jev',
        legacy: 'Grading',
      } as const;
      const groups = new Map<
        string,
        { label: keyof typeof descriptions; model: string; known: number; unknown: boolean }
      >();
      for (const call of run.gradingUsage) {
        const key = `${call.component}:${call.model}`;
        const group = groups.get(key) ?? {
          label: labels[call.component],
          model: call.model,
          known: 0,
          unknown: false,
        };
        group.known += call.costUsd ?? 0;
        group.unknown ||= call.costUsd === null;
        groups.set(key, group);
      }
      for (const group of groups.values())
        add(group.label, group.model, group.known, true, group.unknown);
      continue;
    }
    if (run.judgeCostUsd === 0) continue;
    const review = judge?.groundingReview;
    const jev = judge?.groundingClassifier;
    const used = !!judge || run.judgeCostUsd !== null;
    // Never guess how a known combined estimate splits when component prices are missing.
    if (
      !judge ||
      (run.judgeCostUsd !== null && (review?.costUsd === null || jev?.costUsd === null))
    ) {
      add('Grading', judge?.model, run.judgeCostUsd, used);
      continue;
    }
    const reviewCost = review?.costUsd ?? 0;
    const jevCost = jev?.costUsd ?? 0;
    const primary = run.judgeCostUsd === null ? null : run.judgeCostUsd - reviewCost - jevCost;
    // Database REAL rounding may produce a tiny negative residual at zero.
    if (primary !== null && primary < -0.000001) {
      add('Grading', judge.model, run.judgeCostUsd, used);
      continue;
    }
    add('Claude judge', judge.model, primary === null ? null : Math.max(0, primary), used);
    add(
      'Evidence reviewer',
      review?.model,
      review?.costUsd ?? null,
      !!review && (review.inputTokens + review.outputTokens > 0 || (review.costUsd ?? 0) > 0),
    );
    add(
      'Jev',
      jev?.model,
      jev?.costUsd ?? null,
      !!jev && ((jev.inputTokens ?? 0) + (jev.outputTokens ?? 0) > 0 || (jev.costUsd ?? 0) > 0),
    );
  }
  const order = Object.keys(descriptions);
  const items = [...rows.values()].sort((a, b) => order.indexOf(a.label) - order.indexOf(b.label));
  return {
    experimentId: experiment.id,
    name: experiment.name,
    rows: items,
    estimatedCostUsd: items.reduce((sum, row) => sum + row.estimatedCostUsd, 0),
    unknownEstimates: items.reduce((sum, row) => sum + row.unknownEstimates, 0),
    retriedRuns: runs.filter((run) => run.attempts > 1).length,
  };
}
