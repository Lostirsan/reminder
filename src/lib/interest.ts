// Legal commercial late-interest rate for transactions between companies (DL 62/2013, art. 102 §5
// Código Comercial): ECB rate + 8 pp, fixed per semester by an Aviso of the DGTF.
// Add a row each January and July when the new Aviso is published.
export const LEGAL_RATES = [
  { from: "2026-07-01", rate: 10.4, ref: "Aviso n.º 16623/2026/2" },
] as const;

export function legalRate(today = new Date().toISOString().slice(0, 10)) {
  const sorted = [...LEGAL_RATES].sort((a, b) => b.from.localeCompare(a.from));
  return sorted.find((r) => r.from <= today) ?? sorted[sorted.length - 1];
}

/** Rate used for an organisation: the legal one unless a contractual rate was set. */
export function interestRateOf(org: { late_interest_custom?: boolean; late_interest_rate: number | string }) {
  return org.late_interest_custom ? Number(org.late_interest_rate) : legalRate().rate;
}
