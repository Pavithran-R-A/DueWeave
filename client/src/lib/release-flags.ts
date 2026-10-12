export const RELEASE_FLAG_NAMES = ["VITE_PUBLIC_SIGNUP_ENABLED", "VITE_AUTH_EMAIL_ENABLED"] as const;

export type ReleaseFlagName = (typeof RELEASE_FLAG_NAMES)[number];

const ON = "true";
const OFF = "false";

export function releaseFlagEnabled(value: string | boolean | null | undefined): boolean {
  return value === ON;
}

export function missingReleaseFlagSpecs(environment: Record<string, string | undefined>): ReleaseFlagName[] {
  return RELEASE_FLAG_NAMES.filter((name) => {
    const value = environment[name];
    return value !== ON && value !== OFF;
  });
}

export function releaseFlagBuildError(
  environment: Record<string, string | undefined>,
  { building }: { building: boolean },
): string | null {
  if (!building) return null;
  const unstated = missingReleaseFlagSpecs(environment);
  if (unstated.length === 0) return null;
  return (
    `A build must state ${unstated.join(" and ")} as exactly "true" or "false". ` +
    `An unstated flag would compile into the deployed bundle as its default, which is how a ` +
    `forgotten flag once turned public signup and password recovery on by itself. ` +
    `Set it in the build environment, or in the .env.local that scripts/local-supabase-env.mjs writes for the local stack.`
  );
}
