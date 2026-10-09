import { supabase } from "@/lib/supabase";
import { collectAllRows } from "./pagination";
import type { Client } from "@/types/domain";
import { toClient, userFacingDataError } from "./supabase-adapters";

export interface CreateClientInput {
  name: string;
  company?: string;
  phone?: string;
  email?: string;
  notes?: string;
}

export interface UpdateClientInput extends CreateClientInput {
  id: string;
  // The `updatedAt` value this row was read with. The database refuses the
  // write unless it still matches, so a lost session cannot overwrite a saved one.
  expectedUpdatedAt: string;
}

export class SupabaseClientRepository {
  async list() {
    const rows = await collectAllRows((from, to) => supabase.from("clients")
      .select("id, name, company, phone, email, notes, created_at, updated_at")
      .is("archived_at", null).order("created_at", { ascending: false }).order("id", { ascending: true }).range(from, to));
    return rows.map((row) => toClient(row));
  }

  async create(input: CreateClientInput): Promise<Client> {
    if (!input.name.trim()) throw new Error("Add a client name before saving.");
    const { data, error } = await supabase.rpc("create_client", {
      p_name: input.name.trim(),
      p_company: input.company?.trim() ?? "",
      p_phone: input.phone?.trim() ?? "",
      p_email: input.email?.trim() ?? "",
      p_notes: input.notes?.trim() ?? "",
    });
    if (error) throw new Error(userFacingDataError(error.message, error.code));
    return toClient(data);
  }

  async update(input: UpdateClientInput): Promise<Client> {
    if (!input.id) throw new Error("Choose the client you want to edit.");
    if (!input.expectedUpdatedAt) throw new Error("Reopen this client and save again with the latest version.");
    if (!input.name.trim()) throw new Error("Add a client name before saving.");
    const { data, error } = await supabase.rpc("update_client", {
      p_client_id: input.id,
      p_name: input.name.trim(),
      p_company: input.company?.trim() ?? "",
      p_phone: input.phone?.trim() ?? "",
      p_email: input.email?.trim() ?? "",
      p_notes: input.notes?.trim() ?? "",
      p_expected_updated_at: input.expectedUpdatedAt,
    });
    if (error) throw new Error(userFacingDataError(error.message, error.code));
    return toClient(data);
  }
}
