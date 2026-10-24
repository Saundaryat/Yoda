import type { BusinessInfo, CrmSeed, CrmState } from '@evals/shared';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';

export const CLINIC_TIMEZONE = 'America/Chicago';

export const BUSINESS: BusinessInfo = {
  name: 'Bright Smile Dental',
  address: '1200 Elm St, Dallas, TX 75201',
  timezone: CLINIC_TIMEZONE,
  // Open every day: task slot dates are relative to the run date, which can fall on any weekday.
  hours: 'Open 7 days, 8:00 AM – 6:00 PM',
  services: [
    { id: 'cleaning', name: 'Cleaning and checkup', priceUsd: 120, durationMin: 60 },
    { id: 'whitening', name: 'Teeth whitening', priceUsd: 350, durationMin: 90 },
    { id: 'consult', name: 'New patient consultation', priceUsd: 75, durationMin: 30 },
    { id: 'filling', name: 'Filling', priceUsd: 180, durationMin: 60 },
  ],
};

/** UTC offset of `timeZone` at `instant`, in minutes (e.g. -300 for CDT). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')!.value;
  const match = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === '-' ? -minutes : minutes;
}

/** The clinic-local calendar date `days` after `now`, as [year, month (1-12), day]. */
function localDatePlus(now: Date, days: number, timeZone: string): [number, number, number] {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone })
    .format(now)
    .split('-')
    .map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return [shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate()];
}

/** Clinic-local wall time → ISO string with the clinic's offset, e.g. 2026-10-23T09:00:00-05:00. */
export function clinicTime(now: Date, days: number, time: string, timeZone = CLINIC_TIMEZONE) {
  const [y, m, d] = localDatePlus(now, days, timeZone);
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const offset = offsetMinutes(guess, timeZone);
  const instant = new Date(guess.getTime() - offset * 60_000);
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${y}-${pad(m)}-${pad(d)}T${time}:00${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(instant);
  return { iso, label };
}

/** Turn a task's CRM seed into concrete state, with slot dates relative to `now`. */
export function materialize(seed: CrmSeed, now: Date): CrmState {
  const slots = seed.slots.map((slot) => {
    const { iso, label } = clinicTime(now, slot.day, slot.time);
    return { id: slot.id, start: iso, label, free: slot.free };
  });
  const startOf = (slotId: string) => slots.find((s) => s.id === slotId)?.start ?? '';
  return {
    business: BUSINESS,
    contacts: Object.fromEntries(seed.contacts.map((c) => [c.id, { ...c, notes: [...c.notes] }])),
    slots,
    appointments: seed.appointments.map((a) => ({ ...a, start: startOf(a.slotId) })),
    escalations: [],
    takenOnFirstTry: [...seed.takenOnFirstTry],
    audit: [],
  };
}

export function loadState(file: string): CrmState {
  return JSON.parse(readFileSync(file, 'utf8')) as CrmState;
}

/** Atomic write: the MCP server and the runner read this file from different processes. */
export function saveState(file: string, state: CrmState): void {
  writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
}
