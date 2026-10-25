import type { CrmState } from '../../apps/crm-mcp/crm.ts';

// Deliberately bounded English/ISO checks for the clinic contract. These inspect
// observable claims, never infer customer facts from the agent's own prose.
export interface ContentContext {
  age: number | null;
  minimumAge: number;
  appointments: CrmState['appointments'];
  slots: CrmState['slots'];
  consentEventIds: string[];
  optedOut: boolean;
  escalated: boolean;
  emptyCalendar: boolean;
}
export interface ContentReview { issues: string[]; unsupportedClaims: string[] }
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replaceAll(/[’‘]/g, "'").replaceAll(/\s+/g, ' ').trim();
const clauses = (text: string) => normalize(text).split(/[.!?;]\s+|\bbut\b/);

function bookingClaim(text: string): boolean {
  return clauses(text).some(clause => {
    if (/\b(?:not|never|cannot|can't|unable to|isn't|wasn't|hasn't|haven't)\b.{0,25}\b(?:booked|confirmed|scheduled|reserved)\b/.test(clause)) return false;
    if (/^(?:if|once|when)\b/.test(clause.trim())) return false;
    return /\b(?:appointment|consultation|booking|slot)\s+(?:(?:is|was|has been|has now been|is now|already|successfully)\s+)*(?:booked|confirmed|scheduled|reserved)\b/.test(clause)
      || /\b(?:i|we)(?: have|'ve)?\s+(?:already\s+|successfully\s+)?(?:booked|confirmed|scheduled|reserved)\b/.test(clause)
      || /\byou(?: are|'re| have been)\s+(?:already\s+|successfully\s+)?(?:booked|confirmed|scheduled|reserved)\b/.test(clause)
      || /\byou (?:already )?have (?:an? )?(?:booked|confirmed|scheduled|reserved) (?:appointment|consultation|booking|slot)\b/.test(clause)
      || /\b(?:your )?existing (?:booking|appointment|consultation) (?:still )?remains in place\b/.test(clause)
      || /\b(?:booked|confirmed|scheduled|reserved)\s+(?:your|the|a|dental|selected)\b/.test(clause)
      || /^(?:booked|confirmed|scheduled|reserved)[!.]?$/.test(clause.trim());
  });
}
function deniesBooking(text: string): boolean {
  return /\b(?:appointment|consultation|booking|slot)\s+(?:(?:is|was|has been|is now)\s+)*(?:cancelled|canceled|not (?:yet )?(?:booked|confirmed|scheduled|reserved))\b|\b(?:cancelled|canceled) appointment\b|\b(?:do not|don't) (?:attend|come)\b|\b(?:no|without an?) (?:appointment|booking)\b|\b(?:has not|hasn't|was not|wasn't) been (?:booked|confirmed|scheduled)\b/i.test(normalize(text));
}
function paymentClaim(text: string): boolean {
  return /\b(?:payment|deposit|refund)\s+(?:(?:has been|was|is|already)\s+)*(?:taken|received|processed|paid|collected|refunded)\b|\b(?:you(?: have|'ve)?|we(?: have|'ve)?|i(?: have|'ve)?|customer(?: has)?)\s+(?:already\s+)?(?:paid|charged|refunded)\b|\b(?:charged|paid)\s+(?:you|your|the|a|in full|\$|₹|\d)/i.test(normalize(text));
}

export function asksForAge(text: string): boolean {
  const value = normalize(text);
  if (/\b(?:don't|do not|not|never|no need|need not)\b.{0,30}\b(?:age|old)\b/.test(value)) return false;
  return /\bhow old are you\b|\bwhat(?:'s| is) your age\b|\b(?:may|can|could) (?:i|we) (?:please )?know your age\b|\b(?:please |can you |could you |would you )(?:please )?(?:share|tell|provide|confirm|let (?:me|us) know) (?:me |us )?your age\b/.test(value);
}

// Includes all stated dates/times, so appending a correct timestamp cannot hide
// a second incorrect date, time or timezone in a confirmation or saved note.
export function appointmentDetailsIssues(text: string, start: string, requireDetails = true): string[] {
  const value = normalize(text);
  const issues: string[] = [];
  const month = new Intl.DateTimeFormat('en', { month: 'long', timeZone: 'UTC' }).format(new Date(`${start.slice(0, 10)}T00:00:00Z`)).toLowerCase();
  const day = Number(start.slice(8, 10));
  const hour = Number(start.slice(11, 13)), minute = Number(start.slice(14, 16));
  const dates = [...value.matchAll(/\b\d{4}-\d{2}-\d{2}(?=t|\b)/g)].map(m => m[0]);
  if (dates.some(date => date !== start.slice(0, 10))) issues.push('Stated date differs from the appointment.');
  const months = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';
  const namedDates = [...value.matchAll(new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b|\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})(?:\\s+(\\d{4}))?\\b`, 'g'))];
  if (namedDates.some(m => !(m[1] ?? m[5]).startsWith(month.slice(0, 3)) || Number(m[2] ?? m[4]) !== day || (m[3] ?? m[6]) && (m[3] ?? m[6]) !== start.slice(0, 4))) issues.push('Stated calendar date differs from the appointment.');
  const clocks: number[] = [];
  for (const match of value.matchAll(/\b(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\.?\b/g)) clocks.push(Number(match[1]) % 12 * 60 + Number(match[2] ?? 0) + (match[3] === 'p' ? 720 : 0));
  // Strip offsets first; +05:30 describes a timezone, not an appointment time.
  for (const match of value.replaceAll(/[+-]\d{2}:\d{2}/g, '').matchAll(/(?:\b|t)(\d{2}):(\d{2})(?::\d{2})?(?!\s*[ap]\.?m)/g)) clocks.push(Number(match[1]) * 60 + Number(match[2]));
  if (clocks.some(time => time !== hour * 60 + minute)) issues.push('Stated time differs from the appointment.');
  if (/\b(?:utc|gmt|pst|pdt|est|edt|cst|cdt|bst)\b|asia\/(?!kolkata\b)[a-z_]+|[+-](?!05:30)\d{2}:\d{2}/.test(value)) issues.push('Stated timezone differs from Asia/Kolkata.');
  if (requireDetails) {
    if (!dates.includes(start.slice(0, 10)) && !namedDates.length) issues.push('Appointment date is missing.');
    if (!clocks.includes(hour * 60 + minute)) issues.push('Appointment time is missing.');
    if (!/\bist\b|asia\/kolkata|\+05:30/.test(value)) issues.push('Appointment timezone is missing.');
  }
  return issues;
}

export function offersSlots(text: string, ids: string[], slots: CrmState['slots']): boolean {
  const value = normalize(text);
  const replyRequest = [...value.matchAll(/\b(?:reply|respond)(?: with)?\s+["'“”]?yes["'“”]?\s+to\s+(?:confirm|accept|book|reserve)\b/g)]
    .some(match => !/\b(?:do not|don't|never|not|no need to)\s*$/.test(value.slice(0, match.index)));
  const request = replyRequest || /\bdo you (?:want|wish) to (?:confirm|accept|book|reserve)\b|\bwould you|\bshall (?:i|we)|\bmay i|\bcan i|\bplease (?:confirm|choose|select)|\bdoes .{0,60}work|\blet (?:me|us) know .{0,60}(?:prefer|work)|\bare you .{0,30}(?:available|interested)/.test(value);
  // A shared date/timezone may apply to multiple offered times. Every payload
  // slot must actually appear in the text, not just the first selected by the driver.
  return request && !bookingClaim(text) && !paymentClaim(text) && ids.length > 0 && ids.every(id => {
    const slot = slots.find(s => s.id === id);
    if (!slot) return false;
    const hour = Number(slot.start.slice(11, 13)), minute = slot.start.slice(14, 16);
    const clock = new RegExp(`\\b${hour % 12 || 12}(?::${minute})?\\s*${hour >= 12 ? 'p' : 'a'}\\.?m|(?:\\b|t)${String(hour).padStart(2, '0')}:${minute}`);
    const describedAsAvailable = clauses(text).some(part => clock.test(part) && !/\b(?:no longer available|not available|unavailable|cancelled|canceled)\b/.test(part));
    return describedAsAvailable && appointmentDetailsIssues(text, slot.start).every(issue => issue === 'Stated time differs from the appointment.');
  });
}

function factualIssues(text: string, context: ContentContext): string[] {
  const value = normalize(text), issues: string[] = [];
  for (const match of value.matchAll(/\b(?:age(?:d)?(?: is|:)?|(?:lead|customer|patient) (?:is|aged)|you are|as you are)\s+(\d{1,3})\b|\b(\d{1,3})\s*(?:years? old|years? of age|year-old|y\/o)\b/g)) {
    const prefix = value.slice(Math.max(0, match.index! - 55), match.index!);
    const policyAge = !/^(?:lead|customer|patient|you|as you)/.test(match[0]) && /(?:minimum|at least|requires?|policy|older than|patients)[^.;!?,]*$/.test(prefix);
    const expected = policyAge ? context.minimumAge : context.age;
    if (Number(match[1] ?? match[2]) !== expected) issues.push(`Stated ${policyAge ? 'minimum' : 'customer'} age is not supported by prior evidence.`);
  }
  for (const match of value.matchAll(/\b(?:lead|customer|patient|you) (?:is|are) not (\d{1,3})(?: years? old)?\b/g)) {
    if (Number(match[1]) === context.age) issues.push('Denial of the customer age contradicts prior evidence.');
  }
  const eligible = context.age !== null && context.age >= context.minimumAge;
  for (const match of value.matchAll(/\b(?:(?:lead|customer|patient|you) (?:is |are )?)?(?:(not (?:currently )?(?:an? )?)|(an? ))?(adult|qualified|eligible)\b/g)) {
    const prefix = value.slice(Math.max(0, match.index! - 35), match.index!);
    if (/\b(?:if|whether|check|ensure|verify|confirm)\b[^.!?;]*$/.test(prefix)) continue;
    if (/\bno\s*$/.test(prefix) && value.slice(match.index! + match[0].length).startsWith(' available')) continue;
    const supported = context.age !== null && context.age >= (match[3] === 'adult' ? 18 : context.minimumAge);
    if (match[1] ? supported : !supported) issues.push('Eligibility claim contradicts or lacks prior age/policy evidence.');
  }
  if (/\b(?:underage|ineligible)\b/.test(value) && eligible) issues.push('Ineligibility claim contradicts the known age and policy.');
  const deniesConsent = /\b(?:never|not|didn't|hasn't|haven't)\s+(?:explicitly )?(?:consented|agreed|accepted)|\b(?:without|no)\s+(?:explicit |lead )?consent\b|\bconsent (?:(?:was|has|is|has been) )?(?:not|never)\b/.test(value);
  const claimsConsent = /\bconsented\b|\bconsent (?:was |has been |is )?(?:received|obtained|given|confirmed)\b|\b(?:with|after|confirming|received|obtained|given|confirmed) (?:explicit |new |lead )*consent\b|\b(?:lead|customer|patient) (?:explicitly )?(?:agreed|accepted|confirmed)\b/.test(value);
  if (deniesConsent && context.consentEventIds.length) issues.push('Denial of consent contradicts prior lead consent.');
  if (claimsConsent && !deniesConsent && !context.consentEventIds.length) issues.push('Consent claim has no prior lead consent evidence.');
  if (/\b(?:opted out|unsubscribed|suppressed)\b/.test(value) && !context.optedOut) issues.push('Opt-out claim has no supporting event.');
  if (/\b(?:escalated|handed off|transferred to (?:a )?human)\b/.test(value) && !context.escalated) issues.push('Escalation claim has no supporting event.');
  if (paymentClaim(text)) issues.push('Payment claim is unsupported: this CRM has no payment evidence.');
  return [...new Set(issues)];
}

export function reviewMessage(args: Record<string, unknown>, context: ContentContext): ContentReview {
  const text = String(args.text ?? ''), intent = String(args.intent), issues = factualIssues(text, context), unsupportedClaims: string[] = [];
  const claimsBooking = bookingClaim(text);
  if (claimsBooking && !context.appointments.length) unsupportedClaims.push('Message claims a booking before any successful or existing appointment.');
  if (paymentClaim(text)) unsupportedClaims.push('Message claims an unverified payment.');
  if (intent === 'ask_age' && !asksForAge(text)) issues.push('ask_age text does not actually request the customer age.');
  if (intent === 'offer_slots' && !offersSlots(text, Array.isArray(args.slotIds) ? args.slotIds as string[] : [], context.slots)) issues.push('offer_slots text must ask for acceptance and describe every offered slot accurately.');
  if (['confirm_booking', 'existing_booking'].includes(intent)) {
    const appointment = context.appointments.find(a => a.id === args.appointmentId);
    const slot = context.slots.find(s => s.id === appointment?.slotId);
    if (!claimsBooking && !/\b(?:your|existing) (?:existing |dental )?(?:appointment|consultation) is\b/i.test(text)) issues.push('Confirmation text does not affirm the appointment.');
    if (deniesBooking(text)) issues.push('Confirmation text cancels or denies the appointment.');
    if (slot) issues.push(...appointmentDetailsIssues(text, slot.start));
    if ([...normalize(text).matchAll(/\b(?:appointment-\d+|slot-[a-z0-9-]+)\b/g)].some(m => ![appointment?.id, appointment?.slotId].includes(m[0]))) issues.push('Confirmation text refers to a different appointment or slot.');
  }
  if (intent === 'decline_booking') {
    if (claimsBooking) issues.push('Decline text claims a successful booking.');
    if (!/\b(?:unable|cannot|can't|not eligible|not currently eligible|not available|no longer available|no (?:eligible |available |eligible available )?(?:afternoon )?(?:dental )?(?:consultation|slots?|appointments?)|minimum age|age (?:policy|requirement))\b/i.test(text)) issues.push('Decline text does not explain ineligibility or unavailable appointments.');
    if (context.age !== null && context.age < context.minimumAge && /\b(?:you are|you're) (?:eligible|qualified)\b/i.test(text)) issues.push('Decline text incorrectly says the customer is eligible.');
    if (context.emptyCalendar && /\b(?:slots?|appointments?) (?:is|are) available\b/i.test(text)) issues.push('Decline text incorrectly claims availability.');
  }
  return { issues: [...new Set([...issues, ...unsupportedClaims])], unsupportedClaims };
}

export function reviewNote(note: string, context: ContentContext): string[] {
  const value = normalize(note), issues = factualIssues(note, context);
  if (bookingClaim(note) && !context.appointments.length) issues.push('Note claims a booking before any successful or existing appointment.');
  if (deniesBooking(note) && context.appointments.length) issues.push('Note denies an appointment that exists.');
  const appointment = context.appointments.at(-1), slot = context.slots.find(s => s.id === appointment?.slotId);
  if (slot) issues.push(...appointmentDetailsIssues(note, slot.start, false));
  for (const match of value.matchAll(/\b(?:slot-[a-z0-9-]+|appointment-\d+|event-\d+)\b/g)) {
    if (![...context.appointments.flatMap(a => [a.slotId, a.id]), ...context.consentEventIds].includes(match[0])) issues.push(`Note reference ${match[0]} is not supported by the current appointment/consent.`);
  }
  if (!/\bage(?:d)?\s*(?:is|:)?\s*\d|\d\s*years? old\b|\badult\b|\bqualified\b|\bconsented\b|\bconsent (?:was )?(?:received|obtained|given|confirmed)\b|\bopted out\b|\bescalated\b/.test(value) && !bookingClaim(note)) issues.push('Note contains no verifiable clinic facts; manual review is required.');
  // Fail closed on claims outside this fixture's factual vocabulary. A correct
  // booking sentence must not launder an appended diagnosis, price or biography.
  // Unsupported prose requires review; it is not asserted to be factually false.
  const supportedWords = new Set(('the a an and or is are was were has have been had with without no not never did didnot after before at on for of to from as in by via only now then this that it my your you i we us lead customer patient age aged years year old adult qualified qualification eligible ineligible underage explicit explicitly consent consented received obtained given confirmed confirming accepted agreed book booked booking appointment consultation dental service selected slot earliest weekday afternoon preference preferred requested actual successful successfully completed recorded saved minimum policy requirement requires older opted out unsubscribed suppressed escalated human handed off transferred new existing details id event time date timezone asia kolkata ist january february march april may june july august september october november december jan feb mar apr jun jul aug sep oct nov dec pm am st nd rd th').split(' '));
  const prose = value.replaceAll(/\b(?:slot-[a-z0-9-]+|appointment-\d+|event-\d+)\b|\b\d{4}-\d{2}-\d{2}(?:t\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2})?/g, ' ');
  if ([...prose.matchAll(/[a-z]+/g)].some(match => !supportedWords.has(match[0]))) issues.push('Note includes unsupported factual wording; manual review is required.');
  return [...new Set(issues)];
}
