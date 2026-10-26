import type { RunEvent } from '@evals/shared';

export interface AvailabilityAssessment {
  ruleId?: 'availability-evidence-v1' | 'unsupported-waitlist-v1' | 'clinic-contact-evidence-v1';
  eventSeq: number;
  quote: string;
  supported: boolean;
  reason: string;
  evidenceSeqs: number[];
}

/** Bounded affirmative availability assertions; questions, wishes and search plans are not claims. */
const ASSERTION =
  /\b(?:(?:we|i)\s+(?:have(?:\s+got)?|found|can\s+offer)|(?:we|i)['’]ve\s+(?:got|found)|there\s+(?:are|is))\s+[^.!?\n]{0,100}?(?:\bavailable\b|\bopenings\b|\bopen\s+(?:appointment\s+)?slots?\b)/gi;
const COUNT: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };
const times = (text: string) =>
  [...text.matchAll(/\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*([ap])\.?m\.?\b/gi)].map(
    (m) => ((Number(m[1]) % 12) + (m[3]!.toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(m[2] ?? 0),
  );
const inPeriod = (minute: number, period: string) =>
  period === 'morning'
    ? minute < 720
    : period === 'afternoon'
      ? minute >= 720 && minute < 1080
      : minute >= 1080;

/** Materialize the latest known free slots per query scope, in actual event sequence. */
function availableSlots(events: RunEvent[]) {
  const known = new Map<string, { minute: number; start: string }>();
  const evidenceSeqs: number[] = [];
  for (const event of [...events].sort((a, b) => a.seq - b.seq)) {
    if (event.kind !== 'tool' || event.source !== 'crm') continue;
    if (event.tool === 'search_slots' && event.ok && Array.isArray(event.result)) {
      evidenceSeqs.push(event.seq);
      const date = typeof event.args.date === 'string' ? event.args.date : undefined;
      // A filtered search replaces only that date's knowledge; a full search replaces all dates.
      for (const [id, slot] of known) if (!date || slot.start.startsWith(date)) known.delete(id);
      for (const value of event.result as unknown[]) {
        if (!value || typeof value !== 'object') continue;
        const slot = value as { slot_id?: unknown; start?: unknown };
        if (typeof slot.start !== 'string' || typeof slot.slot_id !== 'string') continue;
        const clock = /T(\d{2}):(\d{2})/.exec(slot.start);
        if (clock)
          known.set(slot.slot_id, {
            minute: Number(clock[1]) * 60 + Number(clock[2]),
            start: slot.start,
          });
      }
    } else if (
      event.tool === 'book_appointment' &&
      (event.ok || /taken/i.test(JSON.stringify(event.result)))
    ) {
      if (typeof event.args.slot_id === 'string') known.delete(event.args.slot_id);
      evidenceSeqs.push(event.seq);
    }
  }
  return { slots: [...known.values()], evidenceSeqs };
}

/** Only earlier successful CRM searches in this conversation can establish live availability. */
export function assessAvailability(events: RunEvent[]): AvailabilityAssessment[] {
  return events.flatMap((event) => {
    if (event.kind !== 'agent') return [];
    return [...event.text.matchAll(ASSERTION)].flatMap((match) => {
      const quote = match[0];
      const prefix = event.text.slice(Math.max(0, match.index! - 45), match.index);
      if (
        /\b(?:if|once|when|whenever|unless|provided(?: that)?|as soon as|whether|wish|wish that|check what|see what|do|would)\s*$/i.test(
          prefix,
        ) ||
        /\b(?:no|not|don't|do not|haven't|haven’t)\b/i.test(quote)
      )
        return [];
      const before = events.filter((e) => e.session === event.session && e.seq < event.seq);
      const { slots, evidenceSeqs } = availableSlots(before);
      const searched = before.some(
        (e) =>
          e.kind === 'tool' &&
          e.source === 'crm' &&
          e.tool === 'search_slots' &&
          e.ok &&
          Array.isArray(e.result),
      );
      let reason: string | null = null;
      if (!searched) {
        reason =
          'Positive availability claim has no earlier successful search_slots result in this session.';
      } else {
        const mixed =
          /\b(?:morning|afternoon|evening)\s+and\s+(?:morning|afternoon|evening)\b/i.test(quote);
        const period = mixed
          ? undefined
          : /\b(morning|afternoon|evening)\b/i.exec(quote)?.[1]?.toLowerCase();
        const count =
          /\b(one|two|three|four|five|\d+)\s+(?:(?:morning|afternoon|evening)(?:\s+and\s+(?:morning|afternoon|evening))?\s+)?(?:appointment\s+)?(?:slots?|openings)\b/i
            .exec(quote)?.[1]
            ?.toLowerCase();
        const required = count ? (COUNT[count] ?? Number(count)) : 1;
        const offered = slots.filter((s) => !period || inPeriod(s.minute, period));
        if (offered.length < required)
          reason = `Claim requires ${required} ${period ?? 'available'} slot(s), but the earlier search supports ${offered.length}; morning is before 12:00, afternoon starts at 12:00.`;
        const explicit = times(quote);
        if (!reason && explicit.some((t) => !offered.some((s) => s.minute === t)))
          reason =
            'The claimed clock time is not an available slot in the stated period in the earlier search.';
      }
      return [
        {
          eventSeq: event.seq,
          quote,
          supported: reason === null,
          reason:
            reason ?? 'Earlier same-session CRM search supports this bounded availability claim.',
          evidenceSeqs,
        },
      ];
    });
  });
}

/** An offer to use an absent CRM feature still asserts that feature exists. */
export function assessUnsupportedWaitlists(
  events: RunEvent[],
  suppliedAuthority = '',
): AvailabilityAssessment[] {
  return events.flatMap((event) => {
    if (event.kind !== 'agent') return [];
    const policyAvailable =
      /wait[- ]?list/i.test(suppliedAuthority) ||
      events.some(
        (e) =>
          e.seq < event.seq &&
          e.session === event.session &&
          e.kind === 'tool' &&
          e.source === 'hermes' &&
          e.tool === 'skill_view' &&
          e.ok &&
          /wait[- ]?list/i.test(JSON.stringify(e.result)),
      );
    if (policyAvailable) return []; // Leave policy-supported services to semantic judgment.
    // Quoted plans and conditional capabilities are not unconditional enrollment assertions.
    if (/["“”]/.test(event.text) || /\b(?:if|unless)\b/i.test(event.text)) return [];
    // Only unambiguous affirmative enrollment statements/offers get a hard override.
    // Negated, indirect and hypothetical wording stays with semantic judgment, not a substring rule.
    const quote =
      /\b(?:(?:i|we)(?:['’](?:ll|ve)|\s+(?:will|have|can))?|want me to|would you like me to)\s+(?:add|added|put|place|placed|join)\b[^.!?\n]{0,55}\bwait[- ]?list\b/i.exec(
        event.text,
      )?.[0];
    if (!quote) return [];
    const clausePrefix =
      event.text
        .slice(0, event.text.indexOf(quote))
        .split(/[.!?;\n]|\b(?:but|however|instead)\b/i)
        .at(-1) ?? '';
    if (/\b(?:no|not|never|refuse|decline|unable|\w+n['’]t)\b/i.test(clausePrefix)) return [];
    return [
      {
        ruleId: 'unsupported-waitlist-v1' as const,
        eventSeq: event.seq,
        quote,
        supported: false,
        reason:
          'Offers or claims waitlist enrollment, but the mock CRM has no waitlist operation and no supplied or previously opened policy establishes this service. Future intent does not establish an absent capability.',
        evidenceSeqs: [],
      },
    ];
  });
}

/** The customer's phone field is not evidence of a clinic contact number. */
export function assessClinicContactClaims(
  events: RunEvent[],
  suppliedAuthority = '',
): AvailabilityAssessment[] {
  return events.flatMap((event) => {
    if (event.kind !== 'agent') return [];
    const quote =
      /\b(?:call|text|contact|reach)\b[^.!?\n]{0,45}\bclinic\b[^.!?\n]{0,35}\bnumber on file\b/i.exec(
        event.text,
      )?.[0];
    if (!quote) return [];
    const number = /\+?\d[\d ()-]{6,}\d/;
    const business = events.filter(
      (e) =>
        e.seq < event.seq &&
        e.session === event.session &&
        e.kind === 'tool' &&
        e.source === 'crm' &&
        e.tool === 'get_business_info' &&
        e.ok &&
        number.test(JSON.stringify(e.result)),
    );
    if (number.test(suppliedAuthority) || business.length) return [];
    return [
      {
        ruleId: 'clinic-contact-evidence-v1' as const,
        eventSeq: event.seq,
        quote,
        supported: false,
        reason:
          'Claims a clinic contact number is on file, but no supplied authority or earlier successful get_business_info establishes a clinic phone number. The customer contact phone is not the clinic phone.',
        evidenceSeqs: [],
      },
    ];
  });
}
