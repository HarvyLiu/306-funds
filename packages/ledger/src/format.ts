const wholeNumberFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  useGrouping: true,
});

export function formatTwd(amount: number): string {
  if (!Number.isSafeInteger(amount)) {
    throw new RangeError('TWD amount must be a safe whole number');
  }

  const sign = amount < 0 ? '-' : '';
  return `${sign}NT$${wholeNumberFormatter.format(Math.abs(amount))}`;
}

export function formatSignedTwd(amount: number): string {
  const formatted = formatTwd(amount);
  return amount >= 0 ? `+${formatted}` : formatted;
}
