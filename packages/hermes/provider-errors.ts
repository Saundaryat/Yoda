// Hermes may retry a provider failure inside an otherwise "running" turn.
// Detect explicit provider evidence; a slow model alone is not an outage.
export function providerFailure(log: string): string | null {
  return /openai\.RateLimitError:|error_type=RateLimitError|HTTP 429:/.test(log)
    ? 'Provider rate limited (HTTP 429); not an agent behavior failure' : null;
}
