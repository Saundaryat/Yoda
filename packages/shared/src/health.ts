export interface HealthStatus {
  scoringVersion?: string;
  comparisonVersion?: string;
  database: 'ok' | 'unavailable';
  /** `hermes --version` first line, or null when Hermes isn't installed (host dev mode). */
  hermes: string | null;
}
