export function extractBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1];
}

export function parseCommaSeparatedEnv(raw: string | undefined): string[] {
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
}
