import { supabase } from "@/lib/supabase";
import { toClient, userFacingDataError } from "./supabase-adapters";

export class SupabaseClientRepository {
  async list() {
    const { data, error } = await supabase.from("clients").select("id, name, company, phone, email, notes, created_at").is("archived_at", null).order("created_at", { ascending: false });
    if (error) throw new Error(userFacingDataError(error.message));
    return (data ?? []).map((row) => toClient(row));
  }
}
