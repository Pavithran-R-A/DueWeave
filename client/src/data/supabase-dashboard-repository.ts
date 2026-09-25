import type { LedgerState } from "@/types/domain";
import { SupabaseActivityRepository } from "./supabase-activity-repository";
import { SupabaseClientRepository } from "./supabase-client-repository";
import { SupabasePaymentRepository } from "./supabase-payment-repository";
import { SupabasePromiseRepository } from "./supabase-promise-repository";
import { SupabaseReceivableRepository } from "./supabase-receivable-repository";

export class SupabaseDashboardRepository {
  private readonly clients = new SupabaseClientRepository();
  private readonly receivables = new SupabaseReceivableRepository();
  private readonly promises = new SupabasePromiseRepository();
  private readonly payments = new SupabasePaymentRepository();
  private readonly activities = new SupabaseActivityRepository();

  // Settling an overdue promise writes to the database, so it gets its own
  // name instead of hiding inside a method called read().
  async settleDuePromises() {
    await this.promises.markDuePromisesBroken();
  }

  async read(): Promise<LedgerState> {
    const [clients, receivables, promises, payments, activities] = await Promise.all([this.clients.list(), this.receivables.list(), this.promises.list(), this.payments.list(), this.activities.list()]);
    return { clients, receivables, promises, payments, activities };
  }
}
