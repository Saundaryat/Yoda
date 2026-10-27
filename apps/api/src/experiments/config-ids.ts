/** Every version of an experiment, baseline first. Rows from before multi-version support are A/B. */
export function experimentConfigIds(row: {
  configIds: string[] | null;
  baselineConfigId: string;
  candidateConfigId: string;
}): string[] {
  return row.configIds?.length ? row.configIds : [row.baselineConfigId, row.candidateConfigId];
}
