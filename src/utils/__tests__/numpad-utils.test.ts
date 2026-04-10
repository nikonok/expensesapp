import { describe, it, expect } from 'vitest';
import { formatNumpadDisplay } from '../numpad-utils';

describe('formatNumpadDisplay', () => {
  it('returns "0" for empty string', () => {
    expect(formatNumpadDisplay('')).toBe('0');
  });

  it('returns "0" for "0"', () => {
    expect(formatNumpadDisplay('0')).toBe('0');
  });

  it('returns single digit unchanged', () => {
    expect(formatNumpadDisplay('5')).toBe('5');
  });

  it('formats 4-digit number with space', () => {
    expect(formatNumpadDisplay('1234')).toBe('1 234');
  });

  it('formats 7-digit number with two spaces', () => {
    expect(formatNumpadDisplay('1234567')).toBe('1 234 567');
  });

  it('formats decimal number, only integer part gets spaces', () => {
    expect(formatNumpadDisplay('1234.56')).toBe('1 234.56');
  });

  it('preserves trailing decimal point', () => {
    expect(formatNumpadDisplay('1234.')).toBe('1 234.');
  });

  it('formats segments around ASCII + operator', () => {
    expect(formatNumpadDisplay('1234+567')).toBe('1 234+567');
  });

  it('formats segments around Unicode minus U+2212', () => {
    expect(formatNumpadDisplay('1234\u2212567')).toBe('1 234\u2212567');
  });

  it('formats segments around Unicode multiply U+00D7', () => {
    expect(formatNumpadDisplay('1234567.89\u00d7100')).toBe('1 234 567.89\u00d7100');
  });

  it('formats large round number with spaces', () => {
    expect(formatNumpadDisplay('1000000')).toBe('1 000 000');
  });
});
