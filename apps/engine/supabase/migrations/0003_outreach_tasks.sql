create table if not exists public.outreach_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  lead_id uuid references public.reception_leads(id) on delete set null,
  lead_company text not null,
  lead_company_norm text not null,
  channel text not null check (channel in ('call', 'form', 'platform')),
  status text not null default 'pending_approval'
    check (status in ('pending_approval', 'approved', 'running', 'sent', 'responded', 'completed', 'skipped', 'failed')),
  destination text,
  source_url text,
  message text,
  metadata jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  sent_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, lead_company_norm, channel)
);

create index if not exists outreach_tasks_tenant_status_idx
  on public.outreach_tasks (tenant_id, status, created_at desc);

create index if not exists outreach_tasks_lead_idx
  on public.outreach_tasks (lead_id);
