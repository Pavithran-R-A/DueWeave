// The support mailbox is supplied by the owner in the Pages build environment (VITE_SUPPORT_EMAIL),
// so the address never sits in this public repository. While it is absent, every screen keeps the
// "no published channel" copy; supplying a valid address is the whole activation.

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]{2,}$/;

export function resolveSupportEmail(value: string | null | undefined): string | null {
  const candidate = (value ?? "").trim();
  return ADDRESS.test(candidate) ? candidate : null;
}

export const SUPPORT_EMAIL = resolveSupportEmail(import.meta.env.VITE_SUPPORT_EMAIL);
