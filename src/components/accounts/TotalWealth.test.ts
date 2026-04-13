import { describe, it, expect } from 'vitest';
import { cellFontSize } from './TotalWealth';

describe('cellFontSize', () => {
  it('returns --text-body for a short string (under 11 chars)', () => {
    expect(cellFontSize('$1,234.56')).toBe('var(--text-body)');
  });

  it('returns --text-body for exactly 10-char string', () => {
    expect(cellFontSize('1234567890')).toBe('var(--text-body)');
  });

  it('returns --text-amount-sm for exactly 11-char string', () => {
    expect(cellFontSize('12345678901')).toBe('var(--text-amount-sm)');
  });

  it('returns --text-amount-sm for exactly 13-char string', () => {
    expect(cellFontSize('1234567890123')).toBe('var(--text-amount-sm)');
  });

  it('returns --text-caption for exactly 14-char string', () => {
    expect(cellFontSize('12345678901234')).toBe('var(--text-caption)');
  });

  it('returns --text-caption for a very long string', () => {
    expect(cellFontSize('$1,234,567,890.00')).toBe('var(--text-caption)');
  });
});
