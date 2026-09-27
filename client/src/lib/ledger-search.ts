// Quiet Ledger style reminder: search and filters over the loaded ledger stay pure, deterministic, and honest about cancelled rows.

import type { Client, Receivable } from "@/types/domain";
import { getClient, getOutstanding } from "@/lib/finance";

export type ReceivableStatusFilter = "open" | "paid" | "cancelled" | "all";

function normalizeForSearch(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function fieldMatches(field: string | undefined, needle: string) {
  return field !== undefined && field !== "" && normalizeForSearch(field).includes(needle);
}

export function matchesReceivableQuery(receivable: Receivable, clients: Client[], query: string) {
  const needle = normalizeForSearch(query);
  if (!needle) return true;
  const client = getClient(receivable.clientId, clients);
  return fieldMatches(receivable.title, needle) || fieldMatches(receivable.invoiceRef, needle) || fieldMatches(client?.name, needle) || fieldMatches(client?.company, needle);
}

function matchesReceivableStatus(receivable: Receivable, filter: ReceivableStatusFilter) {
  if (filter === "all") return true;
  if (filter === "cancelled") return receivable.status === "CANCELLED";
  if (filter === "paid") return getOutstanding(receivable) === 0 && receivable.status !== "CANCELLED";
  return getOutstanding(receivable) > 0 && receivable.status !== "CANCELLED";
}

export function selectReceivables(state: { receivables: Receivable[]; clients: Client[] }, options: { filter: ReceivableStatusFilter; query: string }) {
  return state.receivables.filter((receivable) => matchesReceivableStatus(receivable, options.filter) && matchesReceivableQuery(receivable, state.clients, options.query));
}

export function matchesClientQuery(client: Client, query: string) {
  const needle = normalizeForSearch(query);
  if (!needle) return true;
  return fieldMatches(client.name, needle) || fieldMatches(client.company, needle) || fieldMatches(client.email, needle) || fieldMatches(client.phone, needle);
}

export function selectClients(clients: Client[], query: string) {
  return clients.filter((client) => matchesClientQuery(client, query));
}

export function countReceivablesByStatus(receivables: Receivable[]): Record<ReceivableStatusFilter, number> {
  const countOf = (filter: ReceivableStatusFilter) => receivables.filter((receivable) => matchesReceivableStatus(receivable, filter)).length;
  return { open: countOf("open"), paid: countOf("paid"), cancelled: countOf("cancelled"), all: receivables.length };
}
