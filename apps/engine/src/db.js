import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export async function getBusinesses() {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .in("id", ["light-fiber", "sales-agent"]);
  if (error) throw error;
  return data;
}

export async function createLead(businessId, phone, name) {
  const { data, error } = await supabase
    .from("leads")
    .insert({ business_id: businessId, phone, name, status: "pending" })
    .select();
  if (error) throw error;
  return data[0];
}

export async function getLeads(businessId, limit = 10) {
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("business_id", businessId)
    .eq("status", "pending")
    .limit(limit);
  if (error) throw error;
  return data;
}

export async function createCallLog(businessId, leadId, outcome, notes) {
  const { data, error } = await supabase
    .from("call_logs")
    .insert({ business_id: businessId, lead_id: leadId, outcome, notes })
    .select();
  if (error) throw error;
  return data[0];
}

export async function createContract(businessId, leadId, amount) {
  const { data, error } = await supabase
    .from("contracts")
    .insert({ business_id: businessId, lead_id: leadId, amount, status: "draft" })
    .select();
  if (error) throw error;
  return data[0];
}

export async function getCallLogsByBusiness(businessId) {
  const { data, error } = await supabase
    .from("call_logs")
    .select("*, leads(name, phone)")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data;
}
