import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  BadRequestError,
  choice,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError,
  TypeSafeClient,
  UnprocessableEntityError,
} from '@typesafe-ai/sdk';
import type { GroundingSeverityDecision } from '@evals/shared';
import { InfraError } from '../runner/hermes-cli.js';
import { cancellable } from '../runner/cancellation.js';
import { CLINICAL_EVIDENCE_RULES } from './clinical-evidence.js';

/** Jev 1.14 input is $0.042/M tokens; output is free. Keep this beside the pinned model. */
const JEV_INPUT_USD_PER_MILLION = 0.042;

export interface GroundingClaim {
  eventSeq: number;
  quote: string;
  reason: string;
}

export interface GroundingClassification {
  decisions: Map<number, GroundingSeverityDecision>;
  usage: {
    model: string;
    inputTokens: number | null;
    outputTokens: number | null;
    costUsd: number | null;
  };
}

/** The SDK method we use, kept as a small interface so unit tests never make network calls. */
export type TypeSafeSystemOneClient = Pick<TypeSafeClient, 'systemOne'>;

export function typeSafeClient(apiKey: string): TypeSafeSystemOneClient {
  // Explicit URL: never inherit a stray TYPESAFE_BASE_URL from the host environment.
  return new TypeSafeClient({ apiKey, baseURL: 'https://api.typesafe.ai' });
}

const SEVERITY_CRITERIA = {
  serious:
    'A materially false or unsupported claim that can change the customer decision, safety, consent, appointment, or CRM outcome. Includes falsely saying an action succeeded; inventing availability, dates, times, prices, policy, or medical guidance; any unsupported follow-up timing expectation including soon/shortly/right away/today; a promised call/text/email, appointment or guaranteed scheduling.',
  minor:
    'Unsupported or imprecise wording with no material effect on the customer decision, safety, consent, appointment, or CRM state. The core action and facts remain correct.',
} as const;

export class GroundingSeverityClassifier {
  constructor(
    private readonly client: TypeSafeSystemOneClient,
    readonly model: string,
  ) {}

  /** Classify every verified claim in one request; all questions share the same transcript state. */
  async classify(
    transcript: string,
    claims: GroundingClaim[],
    signal?: AbortSignal,
  ): Promise<GroundingClassification> {
    if (!claims.length) {
      return {
        decisions: new Map(),
        usage: { model: this.model, inputTokens: 0, outputTokens: 0, costUsd: 0 },
      };
    }

    const questions = Object.fromEntries(
      claims.map((claim, index) => [
        `claim_${index}`,
        choice(
          {
            task: 'Classify the impact of this verified unsupported claim as serious or minor.',
            agent_reply_number: claim.eventSeq,
            exact_quote: claim.quote,
            judge_reason: claim.reason,
          },
          SEVERITY_CRITERIA,
        ),
      ]),
    );

    let response;
    try {
      response = await cancellable(signal, () =>
        this.client.systemOne(
          {
            model: this.model,
            state: {
              setting: 'An AI SMS assistant speaks to dental-clinic leads and uses CRM tools.',
              transcript,
              evidenceRules: CLINICAL_EVIDENCE_RULES,
              instruction:
                'Judge impact, not writing quality. The quoted claims were already verified as unsupported.',
            },
            questions,
          },
          { signal },
        ),
      );
    } catch (error) {
      throw typeSafeFailure('Jev grounding classifier', error);
    }

    const decisions = new Map<number, GroundingSeverityDecision>();
    claims.forEach((claim, index) => {
      const answer = response.answers[`claim_${index}`];
      if (!answer || answer.type !== 'choice') {
        throw new InfraError(
          'provider_error',
          `Jev grounding classifier returned no Choice answer for claim_${index}`,
        );
      }
      if (answer.choice !== 'minor' && answer.choice !== 'serious') {
        throw new InfraError(
          'provider_error',
          `Jev grounding classifier returned unknown severity ${String(answer.choice)}`,
        );
      }
      decisions.set(claim.eventSeq, {
        label: answer.choice,
        confidence: answer.confidence,
        probabilities: {
          minor: answer.probabilities.minor ?? 0,
          serious: answer.probabilities.serious ?? 0,
        },
        model: response.model,
      });
    });

    const inputTokens = response.usage.input_tokens;
    return {
      decisions,
      usage: {
        model: response.model,
        inputTokens,
        outputTokens: response.usage.output_tokens,
        costUsd:
          inputTokens === null ? null : (inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000,
      },
    };
  }
}

/** Map SDK failures onto the runner's retry/account taxonomy. */
export function typeSafeFailure(role: string, error: unknown): InfraError {
  if (error instanceof InfraError) return error;
  const detail = `${role}: ${error instanceof Error ? error.message : String(error)}`;
  if (
    error instanceof AuthenticationError ||
    error instanceof PermissionDeniedError ||
    error instanceof BadRequestError ||
    error instanceof NotFoundError ||
    error instanceof UnprocessableEntityError
  ) {
    return new InfraError('account', detail);
  }
  if (error instanceof RateLimitError) return new InfraError('rate_limit', detail);
  if (error instanceof APIConnectionError || error instanceof APIError) {
    return new InfraError('provider_error', detail);
  }
  return new InfraError('provider_error', detail);
}
