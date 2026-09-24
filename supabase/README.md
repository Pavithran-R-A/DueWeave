# PROJECT AR-1 Supabase Foundation

The migration in `migrations/20260812150500_secure_foundation.sql` is the reproducible source of truth for the Stage 2 database foundation. It creates all owned-data tables, constraints, indexes, row-level-security policies, free-plan enforcement, immutable history protections, and protected RPC workflows.

The app uses a Supabase **publishable** browser key and relies on RLS. No service-role key, database password, management token, or purchase credential is stored in the client or repository.

## Data lifecycle

Deleting a profile through `delete_my_business_data()` cascades through owned clients, receivables, promises, payments, activities, promise events, entitlements, claims, and analytics events. The Supabase Auth identity remains because deleting it requires a later privileged server-only flow. This prevents application-data orphans without exposing privileged credentials in the browser.

## Later dashboard configuration

Email/password sign-in is enabled through Supabase Auth. Before a production release, set the final site URL and redirect allow-list in the Supabase Auth dashboard. This is intentionally documented here because it cannot be fully represented by SQL migrations.
