// A retry has to look like the same request to the database, so the key is
// minted once when a form opens and reused by every submit from that form.

export function newRequestId() {
  return crypto.randomUUID();
}

export function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
