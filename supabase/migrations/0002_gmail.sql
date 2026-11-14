-- Phase 3: Gmail OAuth send-flow storage
--
-- profile gains the encrypted refresh token + connection metadata + the
-- physical_address required for a CAN-SPAM-compliant footer.
--
-- suppressions is a permanent block-list keyed by exact email or domain.
-- Used to honor opt-outs ("reply STOP to unsubscribe") and to auto-block
-- domains after Gmail abuse signals (429s, bounces).

alter table profile add column if not exists gmail_refresh_token_encrypted text;
alter table profile add column if not exists gmail_email text;
alter table profile add column if not exists gmail_connected_at timestamptz;
alter table profile add column if not exists physical_address text not null default '';

create table if not exists suppressions (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  domain      text generated always as (split_part(email, '@', 2)) stored,
  reason      text not null default '',
  created_at  timestamptz not null default now(),
  constraint suppressions_email_unique unique (email)
);

create index if not exists suppressions_domain_idx on suppressions (domain);
