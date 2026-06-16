import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

export async function getBusinesses() {
  const { data, error } = await supabase
    .from("businesses")
    .select("*")
    .order("created_at", { ascending: true });
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

export async function createReceptionLead(businessId, lead) {
  const receptionLead = {
    business_id: businessId,
    company: lead.company,
    job_title: lead.jobTitle,
    job_url: lead.jobUrl,
    source: lead.source || "indeed",
    source_url: lead.sourceUrl || null,
    phone: lead.phone || null,
    location: lead.location || null,
    score: lead.score || 0,
    status: "pending",
    reason: lead.reason || null,
    metadata: {
      description: lead.description || "",
      matched_keywords: lead.matched_keywords || [],
      direct_signals: lead.direct_signals || [],
      reject_keywords: lead.reject_keywords || [],
    },
  };

  const { data, error } = await supabase
    .from("reception_leads")
    .upsert(receptionLead, { onConflict: "business_id,job_url" })
    .select();

  if (!error) return data[0];

  const fallbackName = [lead.company, lead.jobTitle].filter(Boolean).join(" / ");
  const { data: fallbackData, error: fallbackError } = await supabase
    .from("leads")
    .insert({
      business_id: businessId,
      phone: lead.phone || null,
      name: fallbackName || lead.jobUrl || "reception lead",
      status: "pending",
    })
    .select();

  if (fallbackError) {
    throw new Error(
      `reception_leads insert failed: ${error.message}; leads fallback failed: ${fallbackError.message}`
    );
  }
  return fallbackData[0];
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
