export const CURRENCY_ALIASES: Record<string, readonly string[]> = {
  PLN: ['zl', 'zł', 'zloty'],
  HUF: ['ft', 'forint'],
  CZK: ['kc', 'kč', 'koruna'],
  RON: ['lei', 'leu'],
  BGN: ['lev', 'lv'],
  HRK: ['kn', 'kuna'],
  RSD: ['din', 'dinar'],
  UAH: ['hrn', 'hryvnia', 'hryvna'],
  KZT: ['tenge'],
  GEL: ['lari'],
  AMD: ['dram'],
  AZN: ['manat'],
  BYN: ['ruble', 'rubel'],
  MDL: ['leu'],
  ALL: ['lek'],
  MKD: ['denar'],
  BAM: ['mark', 'marka'],
  CHF: ['franc', 'franken'],
  SEK: ['kr', 'krona'],
  NOK: ['kr', 'krone'],
  DKK: ['kr', 'krone'],
  ISK: ['kr', 'krona'],
  GBP: ['pound', 'quid', 'sterling'],
  USD: ['buck', 'greenback', 'dollar'],
  EUR: ['euro'],
  JPY: ['yen'],
  CNY: ['yuan', 'rmb', 'renminbi'],
  INR: ['rupee'],
  KRW: ['won'],
  THB: ['baht'],
  IDR: ['rupiah'],
  MYR: ['ringgit'],
  PHP: ['peso'],
  VND: ['dong'],
  BRL: ['real'],
  MXN: ['peso'],
  ARS: ['peso'],
  CLP: ['peso'],
  COP: ['peso'],
  PEN: ['sol'],
  ZAR: ['rand'],
  EGP: ['pound'],
  NGN: ['naira'],
  KES: ['shilling'],
  TZS: ['shilling'],
  UGX: ['shilling'],
  MAD: ['dirham'],
  AED: ['dirham'],
  SAR: ['riyal'],
  QAR: ['riyal'],
  ILS: ['shekel'],
  TRY: ['lira'],
  PKR: ['rupee'],
  BDT: ['taka'],
  LKR: ['rupee'],
};

export function levenshteinAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la > lb) return levenshteinAtMost1(b, a);
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i++;
      j++;
    } else {
      edits++;
      if (edits > 1) return false;
      if (la === lb) {
        i++;
        j++;
      } else {
        j++;
      }
    }
  }
  return edits + (lb - j) <= 1;
}

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/\s+/).filter(Boolean);
}


export function filterCurrencies(
  codes: readonly string[],
  query: string,
  getName: (code: string) => string,
): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...codes];

  const tier1 = codes.filter((code) => {
    if (code.toLowerCase().includes(q)) return true;
    if (getName(code).toLowerCase().includes(q)) return true;
    const aliases = CURRENCY_ALIASES[code] ?? [];
    return aliases.some((a) => a.includes(q));
  });

  if (tier1.length > 0) return tier1;

  const queryTokens = tokenize(q);
  return codes.filter((code) => {
    const nameCandidates = [
      ...tokenize(code),
      ...tokenize(getName(code)),
    ];
    return queryTokens.every((qt) =>
      nameCandidates.some((ct) => ct.includes(qt) || levenshteinAtMost1(qt, ct)),
    );
  });
}
