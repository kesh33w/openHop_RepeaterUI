/** Names are presentation only. Radio IDs remain the values sent to the backend. */
export const MAX_RADIO_NAME_LENGTH = 60;

/** Name shown when no custom name is saved: the configured label, else the radio ID. */
export function defaultRadioName(radio: { id: string; label?: unknown }): string {
  if (typeof radio.label === 'string' && radio.label.trim()) return radio.label.trim();
  return radio.id;
}

export function normalizeRadioNames(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter((entry): entry is [string, string] =>
    typeof entry[1] === 'string' && Boolean(entry[1].trim()),
  ).map(([id, name]) => [id, name.trim()]));
}
