/** Saved estimates for work performed in this experiment; provider invoices are not queried. */
export interface CostBreakdownRow {
  id: string;
  label: string;
  model: string | null;
  description: string;
  runs: number;
  estimatedCostUsd: number;
  unknownEstimates: number;
}

export interface CostBreakdown {
  experimentId: string;
  name: string;
  rows: CostBreakdownRow[];
  estimatedCostUsd: number;
  unknownEstimates: number;
  retriedRuns: number;
}
