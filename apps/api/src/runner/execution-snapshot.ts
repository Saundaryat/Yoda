import type { ConfigurationSpec } from '@evals/shared';

/** Credentials are deliberately excluded. Historical records with no snapshot stay historical. */
export interface ExecutionSnapshot {
  version: 1;
  evaluatorVersion: string;
  comparisonVersion: string;
  judgeModel: string | null;
  judgeEnabled: boolean;
  classifierModel: string | null;
  leadModel: string;
  turnTimeoutMs: number;
  runBudgetSeconds: number;
  configurations: Record<string, { spec: ConfigurationSpec; skills: Record<string, string> }>;
}
