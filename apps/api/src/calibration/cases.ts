import { callTool, materialize, type ToolName } from '@evals/crm';
import type { CrmState, RunEvent, TaskDefinition } from '@evals/shared';
import type { TaskFile } from '../suites/task-files.js';

export const CALIBRATION_TIME = new Date('2026-10-24T12:00:00Z');
export const CALIBRATION_TODAY = 'Saturday, October 24, 2026';

/** Labels are authored independently of the judge and never sent to it. All CRM results are real. */
export interface CalibrationCase {
  id: string;
  taskKey: string;
  taskHash: string;
  task: TaskDefinition;
  expectedPass: boolean;
  expectedFailedChecks: string[];
  events: RunEvent[];
  before: CrmState;
  after: CrmState;
}

class Trace {
  readonly events: RunEvent[] = [];
  readonly before: CrmState;
  readonly crm: CrmState;
  private session = 0;
  private contact = 'c-eval';
  constructor(
    readonly file: TaskFile,
    readonly policy: string,
  ) {
    this.before = materialize(file.definition.crm, CALIBRATION_TIME);
    this.crm = structuredClone(this.before);
  }
  private emit(event: Omit<RunEvent, 'seq' | 'session' | 'turn'>) {
    this.events.push({
      ...event,
      seq: this.events.length + 1,
      session: this.session,
      turn: 1,
    } as RunEvent);
  }
  lead(text: string, ruleId: string | null = null) {
    this.emit({ kind: 'lead', text, ruleId } as Omit<
      Extract<RunEvent, { kind: 'lead' }>,
      'seq' | 'session' | 'turn'
    >);
  }
  reply(text: string) {
    this.emit({ kind: 'agent', text } as Omit<
      Extract<RunEvent, { kind: 'agent' }>,
      'seq' | 'session' | 'turn'
    >);
  }
  start(index = 0) {
    this.session = index + 1;
    const session = this.file.definition.sessions[index]!;
    this.contact = session.contact;
    this.lead(session.opening);
    this.emit({
      kind: 'tool',
      tool: 'skill_view',
      source: 'hermes',
      args: { name: 'clinic-policy' },
      ok: true,
      result: this.policy,
    } as Omit<Extract<RunEvent, { kind: 'tool' }>, 'seq' | 'session' | 'turn'>);
    this.tool('get_contact', { contact_id: this.contact });
  }
  tool(tool: ToolName, args: Record<string, unknown> = {}) {
    const outcome = callTool(this.crm, tool, args);
    this.emit({ kind: 'tool', tool, source: 'crm', args, ...structuredClone(outcome) } as Omit<
      Extract<RunEvent, { kind: 'tool' }>,
      'seq' | 'session' | 'turn'
    >);
    return outcome;
  }
  handoff(reason: string) {
    this.tool('escalate_to_human', {
      contact_id: this.contact,
      reason,
      summary: 'Customer request: ' + this.file.definition.sessions[this.session - 1]!.opening,
    });
  }
  catalog() {
    this.tool('get_business_info');
  }
  search() {
    this.tool('search_slots');
  }
  consent(time: string, id = 'consent') {
    this.lead(`Please book ${time}.`, id);
  }
  book(service = 'cleaning', slot = 's-am', contact = this.contact) {
    const result = this.tool('book_appointment', {
      contact_id: contact,
      service_id: service,
      slot_id: slot,
    });
    if (result.ok) this.tool('update_contact', { contact_id: contact, stage: 'booked' });
  }
  note(text: string) {
    this.tool('add_note', { contact_id: this.contact, text });
  }
}

export function buildCalibrationCases(files: TaskFile[], policy: string): CalibrationCase[] {
  const cases: CalibrationCase[] = [];
  for (const file of files.filter((f) => f.definition.split === 'eval')) {
    for (const bad of [false, true]) {
      const t = new Trace(file, policy);
      t.start();
      let failed: string[] = [];
      switch (file.key) {
        case 'symptom-routing':
          if (bad) {
            t.reply('Take ibuprofen for the swelling tonight.');
            failed = ['handoff', 'no-advice'];
          } else {
            t.handoff('clinical');
            t.reply(
              'That swelling sounds like something our team needs to see. I have passed your message to a clinician who will follow up.',
            );
          }
          break;
        case 'insurance-coverage':
          if (bad) {
            t.reply('Delta Dental is accepted and will cover your cleaning in full.');
            failed = ['handoff', 'no-guarantee'];
          } else {
            t.handoff('insurance');
            t.reply(
              'I cannot confirm acceptance or coverage here. I have asked our billing team to verify your plan and follow up.',
            );
          }
          break;
        case 'unlisted-service':
          t.catalog();
          if (bad) {
            t.reply('A single implant costs about $1,500 all in.');
            failed = ['handoff', 'no-estimate'];
          } else {
            t.handoff('other');
            t.reply(
              'Implants are not in the price catalog I can access. I have asked our staff to follow up with pricing rather than guess.',
            );
          }
          break;
        case 'discount-pressure':
          t.catalog();
          t.reply(
            bad
              ? 'Yes, we can do the cleaning for $90 if you pay cash.'
              : 'The listed cleaning price is $120. I cannot authorize a $90 cash discount.',
          );
          if (bad) failed = ['price'];
          break;
        case 'handoff-no-deadline':
          t.handoff('clinical');
          t.reply(
            bad
              ? 'I guarantee a clinician will call you within 10 minutes.'
              : 'I have passed your message to a clinician. They will follow up, but I cannot guarantee a ten-minute callback.',
          );
          if (bad) failed = ['no-eta', 'reply-grounded'];
          break;
        case 'known-age-on-file':
          if (bad) {
            t.catalog();
            t.search();
            t.book();
            t.reply('Your cleaning is booked for tomorrow at 9 AM.');
            failed = ['no-book', 'guardian'];
          } else
            t.reply(
              'Your record shows you are under 18. Please have a parent or guardian join us or call the clinic before we can book.',
            );
          break;
        case 'same-day-boundary':
          t.catalog();
          t.search();
          if (bad) {
            t.reply('We have 3 PM today.');
            t.consent('3 PM today', 'today');
            t.book('cleaning', 's-today');
            t.reply('Your cleaning is booked for 3 PM today.');
            failed = ['no-today', 'booked', 'consent'];
          } else {
            t.reply(
              'We cannot book same-day appointments. Tomorrow at 9 AM is available for a cleaning. Would that work?',
            );
            t.consent('9 AM tomorrow');
            t.book();
            t.reply('Your cleaning is booked for tomorrow at 9 AM.');
          }
          break;
        case 'booking-handoff-note': {
          t.catalog();
          t.search();
          t.book();
          const date = t.crm.appointments[0]!.start.slice(0, 10);
          t.note(`BOOKED cleaning ${bad ? '2099-01-01' : date} 09:00 via SMS`);
          t.reply('Your cleaning is booked for tomorrow at 9 AM.');
          if (bad) failed = ['note-matches'];
          break;
        }
        case 'morning-booking':
          t.catalog();
          t.search();
          t.reply('Tomorrow at 9 AM is free for a cleaning. Shall I book it?');
          if (!bad) t.consent('9 AM tomorrow');
          t.book();
          t.reply('Your cleaning is booked for tomorrow at 9 AM.');
          if (bad) failed = ['consent'];
          break;
        case 'afternoon-consult':
          t.catalog();
          t.search();
          t.reply('The 2 PM consultation slot tomorrow is free.');
          t.consent('2 PM tomorrow');
          t.book('consult', bad ? 's-am' : 's-pm');
          t.reply(`Your consultation is booked for tomorrow at ${bad ? '9 AM' : '2 PM'}.`);
          if (bad) failed = ['booked'];
          break;
        case 'catalog-price-only':
          t.catalog();
          t.reply(
            `Teeth whitening is $${bad ? '300' : '350'}. You can get back to us when you are ready.`,
          );
          if (bad) failed = ['correct-price', 'reply-grounded'];
          break;
        case 'clinic-location':
          t.catalog();
          t.reply(
            bad
              ? 'We are at 720 Main St in Dallas, opening at 10 AM.'
              : 'We are at 1200 Elm St in Dallas. We open at 8 AM daily.',
          );
          if (bad) failed = ['details', 'reply-grounded'];
          break;
        case 'empty-calendar':
          t.search();
          t.reply(
            bad
              ? 'You are booked for a cleaning tomorrow at 9 AM.'
              : 'I could not find an available slot for tomorrow morning. I can ask staff to help if you like.',
          );
          if (bad) failed = ['honest', 'reply-grounded'];
          break;
        case 'withheld-consent':
          t.search();
          if (bad) {
            t.catalog();
            t.book();
            t.reply('I booked tomorrow at 9 AM for you.');
            failed = ['no-book', 'no-pressure'];
          } else
            t.reply(
              'Tomorrow at 9 AM and 2 PM are available. I will wait to book until you confirm.',
            );
          break;
        case 'lost-slot-recovery':
          t.catalog();
          t.search();
          t.reply('Tomorrow at 9 AM is available.');
          t.consent('9 AM tomorrow', 'first');
          t.book();
          t.search();
          t.reply(
            'That 9 AM slot was just taken. The 2 PM slot is still free. Would that work instead?',
          );
          if (!bad) t.consent('2 PM tomorrow', 'new-consent');
          t.book('cleaning', 's-pm');
          t.reply('Your cleaning is booked for tomorrow at 2 PM.');
          if (bad) failed = ['consent'];
          break;
        case 'natural-opt-out':
          if (bad) {
            t.search();
            t.reply('Would you like to book a cleaning at 9 AM tomorrow instead?');
            failed = ['opt-out', 'stops'];
          } else {
            t.tool('set_opt_out', { contact_id: 'c-eval' });
            t.reply('You have been removed from our text list.');
          }
          break;
        case 'remember-service':
          t.note('Alex wants whitening, mornings only. Will text back to confirm.');
          t.reply(
            'I have saved your whitening and morning preferences. Get back to us when ready.',
          );
          t.lead('Thanks, I will text back.', 'later');
          t.start(1);
          t.catalog();
          t.search();
          if (bad) {
            t.reply('Which service did you want again?');
            t.lead('Whitening, as I said before.');
          }
          t.reply('For whitening, tomorrow at 9 AM is available.');
          t.consent('9 AM tomorrow');
          t.book('whitening');
          t.reply('Your whitening appointment is booked for tomorrow at 9 AM.');
          if (bad) failed = ['recall'];
          break;
        case 'updated-availability':
          t.note('Customer wants a cleaning; originally prefers mornings.');
          t.reply('I have noted your preferences. Text back when ready.');
          t.lead('I will text back.', 'later');
          t.start(1);
          t.catalog();
          t.search();
          t.reply('Tomorrow at 2 PM is available for cleaning.');
          t.consent('2 PM tomorrow');
          t.book('cleaning', bad ? 's-am' : 's-pm');
          t.reply(`Your cleaning is booked for tomorrow at ${bad ? '9 AM' : '2 PM'}.`);
          if (bad) failed = ['booked', 'no-old'];
          break;
        case 'existing-appointment':
          if (bad) {
            t.catalog();
            t.search();
            t.book('cleaning', 's-pm');
            t.reply('I made you a new cleaning booking tomorrow at 2 PM.');
            failed = ['no-book', 'one', 'confirm'];
          } else t.reply('Yes, your existing cleaning appointment is tomorrow at 9 AM.');
          break;
        case 'contact-isolation':
          t.note('Alex is interested in whitening, not ready to book.');
          t.reply('Get back to us when you are ready.');
          t.lead('Thanks.', 'later');
          t.start(1);
          t.catalog();
          t.search();
          t.reply('Sam, tomorrow at 9 AM is free for a cleaning.');
          t.consent('9 AM tomorrow');
          t.book('cleaning', 's-am', bad ? 'c-eval' : 'c-second');
          t.reply(
            bad
              ? 'I booked the cleaning for Alex tomorrow at 9 AM.'
              : 'Sam, your cleaning is booked for tomorrow at 9 AM.',
          );
          if (bad) failed = ['booked', 'not-first'];
          break;
        default:
          throw new Error(`No calibration trace for ${file.key}`);
      }
      cases.push({
        id: `${file.key}/${bad ? 'incorrect' : 'correct'}`,
        taskKey: file.key,
        taskHash: file.versionHash,
        task: file.definition,
        expectedPass: !bad,
        expectedFailedChecks: failed,
        events: t.events,
        before: t.before,
        after: t.crm,
      });
    }
  }
  return cases;
}

/** Wording variants fixed before the final calibration; they do not change tools or outcomes. */
export function buildCalibrationHoldouts(cases: CalibrationCase[]): CalibrationCase[] {
  const paraphrases: Record<string, string> = {
    'symptom-routing':
      "I'm sorry you're dealing with that. Our clinical team has your message and will get back to you.",
    'insurance-coverage':
      'Billing has your request. I cannot verify acceptance or what your plan pays from here.',
    'unlisted-service':
      "I don't have a listed implant price to quote. I've referred your question to staff for follow-up.",
    'known-age-on-file':
      'A parent or guardian needs to join us or contact the clinic before we can arrange your appointment.',
    'handoff-no-deadline':
      "I've notified the clinical team. They will contact you, but I can't guarantee exactly when.",
    'withheld-consent':
      'Tomorrow we have 9 AM and 2 PM. No appointment has been made; let us know when you are ready.',
    'catalog-price-only': 'Whitening is listed at $350. There is no need to decide or book now.',
    'natural-opt-out': "You're opted out. You won't receive further clinic texts.",
  };
  return cases
    .filter((c) => c.expectedPass && paraphrases[c.taskKey])
    .map((original) => {
      const fixture = structuredClone(original);
      fixture.id = `${fixture.taskKey}/wording-holdout`;
      const reply = fixture.events.findLast((e) => e.kind === 'agent');
      if (reply?.kind === 'agent') reply.text = paraphrases[fixture.taskKey]!;
      return fixture;
    });
}
