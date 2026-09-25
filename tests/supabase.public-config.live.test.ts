import { describe, expect, it } from "vitest";

// Scoped to a hosted project: the local Docker stack uses a loopback URL and is
// qualified by tests/stage2-local-foundation.test.ts instead.
const hostedProjectUrl = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;
const configuredUrl = process.env.VITE_SUPABASE_URL ?? "";
const hasLivePublicConfiguration = hostedProjectUrl.test(configuredUrl) && Boolean(process.env.VITE_SUPABASE_ANON_KEY);
const describeLiveConfiguration = hasLivePublicConfiguration ? describe : describe.skip;

describeLiveConfiguration("Supabase browser configuration", () => {
  it("authorizes the public auth settings endpoint with the configured anonymous key", async () => {
    const url = process.env.VITE_SUPABASE_URL;
    const anonKey = process.env.VITE_SUPABASE_ANON_KEY;

    expect(url).toMatch(hostedProjectUrl);
    expect(anonKey).toBeTruthy();

    const response = await fetch(`${url}/auth/v1/settings`, {
      headers: { apikey: anonKey! },
    });

    expect(response.status).toBeLessThan(400);
  });
});
