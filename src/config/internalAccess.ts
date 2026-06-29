const INTERNAL_ADMIN_EMAILS = (import.meta.env.VITE_INTERNAL_ADMIN_EMAILS ?? "")
  .split(",")
  .map((value: string) => value.trim().toLowerCase())
  .filter(Boolean);

export function getInternalAdminEmails(): string[] {
  return INTERNAL_ADMIN_EMAILS;
}

export function isInternalAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return INTERNAL_ADMIN_EMAILS.includes(email.trim().toLowerCase());
}
