create table if not exists public.reception_leads (
  id uuid primary key default gen_random_uuid(),
  business_id text not null,
  company text not null,
  job_title text,
  job_url text not null,
  source text not null default 'indeed',
  source_url text,
  phone text,
  location text,
  score integer not null default 0,
  status text not null default 'pending',
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, job_url)
);

create index if not exists reception_leads_business_status_idx
  on public.reception_leads (business_id, status, score desc);

create index if not exists reception_leads_company_idx
  on public.reception_leads (company);
