/** Presentation aliases only. Never change frozen experiment/configuration/task records. */
const versions: Record<string, { name: string; purpose: string }> = {
  'bb492502-d4ff-4d8e-b264-894c7bdd683f': {
    name: 'V1 · Basic booking assistant',
    purpose: 'General instructions and CRM tools; no clinic policy skill.',
  },
  'cc58d4e7-11a7-4770-bbb4-ec9489292332': {
    name: 'V2 · Clinic policy on demand',
    purpose: 'V1 plus a policy skill the agent must choose to open.',
  },
  '75d90f45-fefa-49f4-bb35-236b2dd4df19': {
    name: 'V3 · Clinic policy always included',
    purpose: 'The policy is included in every conversation; no skill lookup needed.',
  },
  '1a381370-08c5-4fbb-b822-f2678ec1d588': {
    name: 'V4 · Save and recall customer preferences',
    purpose: 'V3 plus explicit instructions to save and read contact-specific CRM notes.',
  },
  '476b2d12-1a2d-4ef6-9fe0-29e472f608d2': {
    name: 'V5 · Confirm actions before claiming success',
    purpose:
      'V4 plus instructions to report only completed actions and avoid unsupported follow-up promises.',
  },
};
const stages: Record<string, { step: number; name: string }> = {
  '185acbbc-5a9b-4bc5-a8e9-27e891cd6bf2': {
    step: 1,
    name: '01 · Does access to the clinic policy help?',
  },
  '22793363-85f1-4d43-9cea-0a6df56956b2': {
    step: 2,
    name: '02 · Does including the policy every time help?',
  },
  '3de6b1b6-34f1-46fa-aff0-ce69302484ce': {
    step: 2,
    name: '02 · Does including the policy every time help?',
  },
  '69ff5def-9173-4975-a11f-0f7154f13f5e': {
    step: 3,
    name: '03 · Does saving customer preferences improve recall?',
  },
  'a14ded53-7c33-4f61-addf-931c1bd9ebf0': {
    step: 4,
    name: '04 · Do confirmed actions reduce false promises?',
  },
  '76190125-ae2f-4db2-ae07-7dc99a15cf66': {
    step: 4,
    name: '04 · Do confirmed actions reduce false promises?',
  },
};
const scenarios: Record<string, string> = {
  'afternoon-consult': 'Book an afternoon consultation',
  'booking-handoff-note': 'Leave a staff note after booking',
  'catalog-price-only': 'Answer a price question without booking',
  'clinic-location': 'Give the clinic address',
  'contact-isolation': 'Keep two customers’ details separate',
  'discount-pressure': 'Handle a request for an unauthorized discount',
  'empty-calendar': 'Handle a fully booked calendar',
  'existing-appointment': 'Confirm an existing appointment without duplicating it',
  'handoff-no-deadline': 'Request a callback without promising a deadline',
  'insurance-coverage': 'Handle an insurance question without guaranteeing coverage',
  'known-age-on-file': 'Require guardian involvement when CRM records age 16',
  'lost-slot-recovery': 'Offer a new time when the chosen slot is taken',
  'morning-booking': 'Book a morning cleaning',
  'natural-opt-out': 'Stop texts when the customer asks',
  'remember-service': 'Recall the service discussed in an earlier conversation',
  'same-day-boundary': 'Apply the clinic’s no-same-day-booking rule',
  'symptom-routing': 'Refer gum swelling to a clinician instead of booking',
  'unlisted-service': 'Handle a service with no listed price',
  'updated-availability': 'Use the customer’s latest availability preference',
  'withheld-consent': 'Do not book without the customer’s agreement',
};
const developmentNames: Record<string, string> = {
  'a597c76e-c6c2-419b-9f07-210e7bc4d0d9': 'Development 1 · First booking-assistant test',
  '90fa0457-3421-4799-8ac5-1bf5f46e79dd': 'Development 2 · Add conversation judging',
  '084a7c0c-fa83-4f15-bf1c-d4e0d8b01498': 'Development 3 · Give the judge the run date',
  'd394cc37-6ced-413b-8097-f5a530014188': 'Development 4 · Separate reply style from task success',
  'da238104-ded5-41c6-9a33-a673943519b6': 'Development 5 · Add claim-severity scoring',
};
export const configurationName = (c?: { id: string; name: string } | null) =>
  c ? (versions[c.id]?.name ?? c.name) : 'Loading…';
export const configurationPurpose = (c: { id: string; description: string }) =>
  versions[c.id]?.purpose ?? c.description;
export const experimentName = (e: { id: string; name: string }) =>
  stages[e.id]?.name ?? developmentNames[e.id] ?? e.name;
export const isDevelopmentExperiment = (e: { id: string }) => Boolean(developmentNames[e.id]);
export const experimentStage = (e: { id: string }) => stages[e.id]?.step;
export const taskName = (t: { key: string; title: string }) => scenarios[t.key] ?? t.title;
export const groupName = (group: string) =>
  ({
    policy: 'Clinic rules & safety',
    control: 'Everyday requests',
    memory: 'Returning customers',
  })[group] ?? group;
