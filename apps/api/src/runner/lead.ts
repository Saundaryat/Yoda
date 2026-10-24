import type { SessionScript } from '@evals/shared';

export interface LeadMessage {
  text: string;
  /** The rule that produced this message; null for the opening and the fallback. */
  ruleId: string | null;
  /** LLM lead only: every rule the message means. */
  ruleIds?: string[];
  fallback: boolean;
}

/** Who plays the lead in one session: the scripted rules or an LLM (see llm-lead.ts). */
export interface Lead {
  opening(): LeadMessage;
  /** The lead's answer to `agentReply`, or null when the conversation is over. */
  next(agentReply: string): LeadMessage | null | Promise<LeadMessage | null>;
}

/**
 * The simulated lead for one session. Deterministic: given the same agent replies it always says
 * the same thing, so A/B pairs face the same lead. Each rule fires at most once; the first unfired
 * rule whose pattern matches the agent's latest reply wins.
 */
export class LeadScript implements Lead {
  private readonly fired = new Set<string>();
  private fallbackUsed = false;
  private sent = 0;
  private ending = false;

  constructor(private readonly script: SessionScript) {}

  opening(): LeadMessage {
    this.sent = 1;
    return { text: this.script.opening, ruleId: null, fallback: false };
  }

  /** The lead's answer to `agentReply`, or null when the conversation is over. */
  next(agentReply: string): LeadMessage | null {
    if (this.ending || this.sent >= this.script.maxTurns) return null;
    const rule = this.script.rules.find(
      (r) => !this.fired.has(r.id) && new RegExp(r.when, 'i').test(agentReply),
    );
    if (rule) {
      this.fired.add(rule.id);
      this.sent += 1;
      this.ending = rule.end;
      return { text: rule.say, ruleId: rule.id, fallback: false };
    }
    if (this.script.fallback !== null && !this.fallbackUsed) {
      this.fallbackUsed = true;
      this.sent += 1;
      return { text: this.script.fallback, ruleId: null, fallback: true };
    }
    return null;
  }
}
