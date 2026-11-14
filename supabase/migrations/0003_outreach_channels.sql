-- Add public phone contact and human-reviewed outreach drafts.
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS sms_template text,
  ADD COLUMN IF NOT EXISTS cold_call_script text,
  ADD COLUMN IF NOT EXISTS voicemail_script text;
