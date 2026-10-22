import { z } from 'zod';

/** Dates in task files are relative to the run date, because Hermes puts today's date in the prompt. */
export const slotSeedSchema = z.object({
  id: z.string(),
  /** Days from the run date: 0 = today, 1 = tomorrow. */
  day: z.number().int().min(0),
  /** Local clinic time, 24h "HH:MM". */
  time: z.string().regex(/^\d{2}:\d{2}$/),
  free: z.boolean().default(true),
});

export const contactSeedSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  age: z.number().int().nullable().default(null),
  stage: z.string().default('new'),
  optedOut: z.boolean().default(false),
  notes: z.array(z.string()).default([]),
});

export const appointmentSeedSchema = z.object({
  id: z.string(),
  contactId: z.string(),
  slotId: z.string(),
  serviceId: z.string(),
});

export const crmSeedSchema = z.object({
  contacts: z.array(contactSeedSchema).min(1),
  slots: z.array(slotSeedSchema).default([]),
  appointments: z.array(appointmentSeedSchema).default([]),
  /** Slot ids whose first booking attempt fails as "just taken", to test recovery. */
  takenOnFirstTry: z.array(z.string()).default([]),
});

export type CrmSeed = z.infer<typeof crmSeedSchema>;

export interface Service {
  id: string;
  name: string;
  priceUsd: number;
  durationMin: number;
}

export interface BusinessInfo {
  name: string;
  address: string;
  timezone: string;
  hours: string;
  services: Service[];
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  age: number | null;
  stage: string;
  optedOut: boolean;
  notes: string[];
}

export interface Slot {
  id: string;
  /** ISO timestamp with the clinic's UTC offset. */
  start: string;
  /** Human label in clinic time, e.g. "Fri Oct 23, 9:00 AM". */
  label: string;
  free: boolean;
}

export interface Appointment {
  id: string;
  contactId: string;
  slotId: string;
  serviceId: string;
  start: string;
}

export interface Escalation {
  contactId: string;
  reason: string;
  summary: string;
}

/** One CRM tool call as the CRM saw it. Rejected calls are recorded too. */
export interface AuditEntry {
  seq: number;
  tool: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
}

export interface CrmState {
  business: BusinessInfo;
  contacts: Record<string, Contact>;
  slots: Slot[];
  appointments: Appointment[];
  escalations: Escalation[];
  takenOnFirstTry: string[];
  audit: AuditEntry[];
}
