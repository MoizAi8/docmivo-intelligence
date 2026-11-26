export function allowedTester(input: { email:string; country:string|null; production:boolean; enabled:boolean; testers:string[]; regions:string[] }) {
  const restricted = /^(AT|BE|BG|HR|CY|CZ|DE|DK|EE|ES|FI|FR|GR|HU|IE|IS|IT|LI|LT|LU|LV|MT|NL|NO|PL|PT|RO|SE|SI|SK|CH|GB|UK)$/;
  if (!input.enabled || !input.testers.includes(input.email.toLowerCase())) return false;
  if (!input.production) return true;
  return Boolean(input.country && /^[A-Z]{2}$/.test(input.country) && !restricted.test(input.country) && input.regions.includes(input.country));
}

export function canonicalQuote(value:string) {
  return value.trim().replace(/\s+/gu," ");
}

export function validateCitations(
  candidates: { chunkId:string; quote:string }[],
  source: Map<string,string>,
  requireDocuments: number,
  documents: Map<string,string>
) {
  const used = new Set<string>();
  const covered = new Set<string>();
  for (const candidate of candidates) {
    const quote = canonicalQuote(candidate.quote);
    const text = source.get(candidate.chunkId);
    if (used.has(candidate.chunkId) || quote.length < 12 || !text || !canonicalQuote(text).includes(quote)) return false;
    used.add(candidate.chunkId);
    covered.add(documents.get(candidate.chunkId) ?? "");
  }
  return used.size > 0 && covered.size >= requireDocuments;
}
