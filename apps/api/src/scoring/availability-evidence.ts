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
      const search = before.findLast(
        (e) => e.kind === 'tool' && e.source === 'crm' && e.tool === 'search_slots' && e.ok,
      );
      const evidenceSeqs = search ? [search.seq] : [];
      let reason: string | null = null;
      if (!search || search.kind !== 'tool' || !Array.isArray(search.result)) {
        reason =
          'Positive availability claim has no earlier successful search_slots result in this session.';
      } else {
        const slots = search.result.flatMap((value: unknown) => {
          if (!value || typeof value !== 'object') return [];
          const slot = value as { slot_id?: unknown; start?: unknown };
          if (typeof slot.start !== 'string' || typeof slot.slot_id !== 'string') return [];
          const clock = /T(\d{2}):(\d{2})/.exec(slot.start);
          if (!clock) return [];
          const consumed = before.some(
            (e) =>
              e.seq > search.seq &&
              e.kind === 'tool' &&
              e.source === 'crm' &&
              e.tool === 'book_appointment' &&
              e.args.slot_id === slot.slot_id &&
              (e.ok || /taken/i.test(JSON.stringify(e.result))),
          );
          return consumed
            ? []
            : [{ minute: Number(clock[1]) * 60 + Number(clock[2]), start: slot.start }];
        });
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
    const quote = /\b(?:add|added|put|place|placed|join)\b[^.!?\n]{0,55}\bwait[- ]?list\b/i.exec(
      event.text,
    )?.[0];
    if (!quote) return [];
    const prefix = event.text.slice(
      Math.max(0, event.text.indexOf(quote) - 45),
      event.text.indexOf(quote),
    );
    if (
      /\b(?:can(?:not|['’]t)|don['’]t|do not|not able to|unable to)\s*(?:\w+\s+){0,3}$/i.test(
        prefix,
      )
    )
      return [];
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
