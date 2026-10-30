export function parseRupeesToMinor(value: string | number): number | null {
  const text = String(value).trim().replace(/,/g, '');
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const fraction = match[3] ?? '';
  const paise = Number((fraction + '00').slice(0, 2));
  const shouldRound = (fraction[2] ?? '0') >= '5';
  return sign * (Number(match[2]) * 100 + paise + (shouldRound ? 1 : 0));
}

export function formatINR(minor: number): string {
  const whole = Math.floor(Math.abs(minor) / 100).toString();
  const lastThree = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest
    ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`
    : lastThree;
  const paise = String(Math.abs(minor) % 100).padStart(2, '0');
  return `₹${grouped}.${paise}`;
}

export function formatForeign(minor: number, currency: string): string {
  const whole = Math.floor(Math.abs(minor) / 100).toLocaleString('en-US');
  const fraction = String(Math.abs(minor) % 100).padStart(2, '0');
  return `${currency === 'USD' ? '$' : `${currency} `}${whole}.${fraction}`;
}

export function signedAmount(minor: number, direction: 'debit' | 'credit'): string {
  return `${direction === 'debit' ? '−' : '+'}${formatINR(minor)}`;
}
