import { supabase } from "@/lib/supabase";
import { toClient, userFacingDataError } from "./supabase-adapters";

export interface CreateClientInput {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export class SupabaseClientRepository {
  async list() {
    const { data, error } = await supabase.from("clients").select("id, name, company, phone, email, notes, created_at").is("archived_at", null).order("created_at", { ascending: false });
    if (error) throw new Error(userFacingDataError(error.message));
    return (data ?? []).map((row) => toClient(row));
  }

  async create(input: CreateClientInput) {
    if (!input.name.trim()) throw new Error("Add a client name before saving.");
    const { data, error } = await supabase.rpc("create_client", {
      p_name: input.name.trim(),
      p_company: input.company?.trim() ?? "",
      p_phone: input.phone?.trim() ?? "",
      p_email: input.email?.trim() ?? "",
      p_notes: input.notes?.trim() ?? "",
    });
    if (error) throw new Error(userFacingDataError(error.message));
    return toClient(data);
  }
}
