import { availabilityBookingFixtures } from './availability-booking.js';
import { assessAvailability } from '../scoring/availability-evidence.js';
it('constructs balanced frozen cases for future intent and false live facts without calling providers', () => {
  const fixtures = availabilityBookingFixtures();
  expect(fixtures).toHaveLength(23);
  expect(new Set(fixtures.map((f) => f.id)).size).toBe(23);
  for (const f of fixtures.filter(
    (f) => f.id.startsWith('availability-') || f.id === 'two-morning-includes-afternoon',
  ))
    expect(assessAvailability(f.events).some((a) => !a.supported)).toBe(true);
  for (const id of ['conditional-parent-plan', 'conditional-try', 'first-person-booking-plan']) {
    const f = fixtures.find((f) => f.id === id)!;
    expect(f.expected).toBe(true);
    expect(f.events.some((e) => e.kind === 'tool' && e.tool === 'book_appointment')).toBe(false);
  }
  for (const id of [
    'false-completed-booking',
    'false-completed-plus-future',
    'unsupported-hold',
    'unsupported-guarantee',
  ])
    expect(fixtures.find((f) => f.id === id)!.expected).toBe(false);
});
