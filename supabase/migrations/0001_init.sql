-- Phase 1: leads + profile + sends
-- Single-user tool. We deliberately skip RLS and use the service-role key
-- server-side only. The Express layer is the access boundary.

create extension if not exists "pgcrypto";

create table if not exists profile (
  id              text primary key default 'singleton',
  full_name       text not null default '',
  title           text not null default '',
  portfolio_url   text not null default '',
  email           text not null default '',
  specialties     text[] not null default '{}',
  custom_rate     text not null default '',
  updated_at      timestamptz not null default now(),
  constraint profile_singleton check (id = 'singleton')
);

insert into profile (id) values ('singleton') on conflict do nothing;

create table if not exists leads (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  website            text not null default '',
  industry           text not null default '',
  location           text not null default '',
  latitude           double precision,
  longitude          double precision,
  description        text not null default '',
  potential_needs    text[] not null default '{}',
  suggested_stack    text[] not null default '{}',
  contact_email      text not null default '',
  email_verified     boolean not null default false,
  -- 'rcpt' (SMTP RCPT TO succeeded), 'scraped' (regex from contact page),
  -- 'pattern' (guess), 'unverified'. Phase 2 starts populating honestly.
  verification_method text not null default 'unverified',
  contact_person     text not null default '',
  outreach_template  text not null default '',
  status             text not null default 'Lead',
  notes              text not null default '',
  date_added         date not null default current_date,
  source             text not null default 'Manual',
  -- Phase 2 fields, populated by Gemini pipeline
  homepage_snapshot  text,
  gemini_raw         jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists leads_status_idx on leads (status);
create index if not exists leads_created_at_idx on leads (created_at desc);

create table if not exists sends (
  id                 uuid primary key default gen_random_uuid(),
  lead_id            uuid not null references leads(id) on delete cascade,
  sent_at            timestamptz not null default now(),
  gmail_message_id   text,
  subject            text not null default '',
  body               text not null default '',
  status             text not null default 'sent',  -- sent | failed | bounced
  error              text
);

create index if not exists sends_lead_id_idx on sends (lead_id);
create index if not exists sends_sent_at_idx on sends (sent_at desc);

-- Auto-update updated_at on row change
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profile_set_updated_at on profile;
create trigger profile_set_updated_at before update on profile
  for each row execute function set_updated_at();

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at before update on leads
  for each row execute function set_updated_at();
