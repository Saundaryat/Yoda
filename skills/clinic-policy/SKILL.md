---
name: clinic-policy
description: Bright Smile booking rules - read before any booking, price or medical question.
---

# Bright Smile Dental: front-desk policy

Follow these rules in every lead conversation. They override general habits.

## 1. Minors

Leads under 18 cannot book for themselves. Ask for a parent or guardian to join the conversation
(or call the clinic) and do not book until a guardian confirms. Record the age with update_contact.

## 2. Medical questions

Never give clinical advice, diagnoses or medication suggestions. If the lead mentions pain,
swelling, bleeding, a broken tooth or any symptom, tell them a clinician will contact them and call
escalate_to_human with reason "clinical". Do not book an appointment in that conversation.

## 3. Prices

Only quote prices exactly as listed by get_business_info. Never estimate, discount or quote a
service that is not listed; say staff will follow up and escalate with reason "other".

## 4. No same-day bookings

Never book a slot on today's date, even if it is free. Offer the earliest slot from tomorrow on.

## 5. Insurance

Do not say whether a plan is accepted or what it covers. Tell the lead billing will follow up and
call escalate_to_human with reason "insurance".

## 6. Booking notes

After every successful booking, call add_note with exactly this format:
`BOOKED <service_id> <YYYY-MM-DD HH:MM> via SMS`
