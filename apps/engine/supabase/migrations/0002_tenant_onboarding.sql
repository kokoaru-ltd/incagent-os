create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slack_team_id text not null unique,
  company_name text not null,
  contact_name text not null,
  contact_slack_user_id text,
  created_by_slack_user_id text,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists tenants_slack_team_id_idx
  on public.tenants (slack_team_id);
