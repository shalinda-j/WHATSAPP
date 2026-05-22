import { toCsv, csvDownloadHeaders } from '../server/utils/csv';
import { resolveContactExportPhone } from '../server/routes/exports';
import {
  extractPhoneFromText,
  normalisePhoneDigits,
} from '../services/LidPhoneMappingService';

describe('toCsv', () => {
  it('renders an empty string for zero rows without columns', () => {
    expect(toCsv([])).toBe('');
  });

  it('renders just the header for zero rows when columns are given', () => {
    expect(toCsv([], ['a', 'b'])).toBe('a,b\n');
  });

  it('uses the union of row keys when columns are omitted', () => {
    const csv = toCsv([
      { a: 1, b: 2 },
      { b: 3, c: 4 },
    ]);
    expect(csv.split('\n')[0].split(',').sort()).toEqual(['a', 'b', 'c']);
  });

  it('quotes cells with commas, quotes, or newlines', () => {
    const csv = toCsv([{ name: 'Smith, John', note: 'has "quotes"\nand newline' }]);
    const lines = csv.trim().split('\n');
    expect(lines[1]).toContain('"Smith, John"');
    expect(lines[1]).toContain('"has ""quotes""\nand newline"');
  });

  it('serialises Date values as ISO-8601 UTC', () => {
    const csv = toCsv([{ when: new Date('2026-05-17T12:34:56Z') }]);
    expect(csv).toContain('2026-05-17T12:34:56.000Z');
  });

  it('renders null/undefined as empty cells', () => {
    const csv = toCsv([{ a: null, b: undefined, c: 'x' }], ['a', 'b', 'c']);
    expect(csv).toContain('\n,,x\n');
  });

  it('preserves the column order given explicitly', () => {
    const csv = toCsv([{ z: 1, a: 2 }], ['a', 'z']);
    expect(csv.split('\n')[0]).toBe('a,z');
  });
});

describe('csvDownloadHeaders', () => {
  it('sanitises the filename', () => {
    const h = csvDownloadHeaders('Bad/Name *with weird?.csv');
    expect(h['Content-Disposition']).toContain('Bad_Name__with_weird_.csv');
  });

  it('sets the text/csv content-type', () => {
    expect(csvDownloadHeaders('x.csv')['Content-Type']).toBe(
      'text/csv; charset=utf-8',
    );
  });
});

describe('resolveContactExportPhone', () => {
  it('exports normal phone-backed identifiers as clean phone numbers', () => {
    expect(
      resolveContactExportPhone({ phone: '+94 77 123 4567' }),
    ).toBe('+94771234567');
    expect(
      resolveContactExportPhone({ whatsappNumber: '94771234567@s.whatsapp.net' }),
    ).toBe('+94771234567');
  });

  it('does not export a LID as a phone number', () => {
    expect(resolveContactExportPhone({ phone: '+29141520924734@lid' })).toBe('');
  });

  it('repairs old LID contacts from stored chat realPhone metadata', () => {
    const map = new Map([['29141520924734@lid', '94771234567']]);
    expect(
      resolveContactExportPhone({ phone: '+29141520924734@lid' }, map),
    ).toBe('+94771234567');
  });

  it('repairs old LID contacts when the stored mapping key has no suffix', () => {
    const map = new Map([['29141520924734', '94771234567']]);
    expect(
      resolveContactExportPhone({ whatsappNumber: '29141520924734@lid' }, map),
    ).toBe('+94771234567');
  });
});

describe('LID phone repair helpers', () => {
  it('normalises Sri Lankan local mobile numbers', () => {
    expect(normalisePhoneDigits('0703179882')).toBe('94703179882');
    expect(normalisePhoneDigits('+94 70 317 9882')).toBe('94703179882');
  });

  it('extracts a phone number from inbound message text', () => {
    expect(extractPhoneFromText('hi my number is 0703179882')).toBe(
      '94703179882',
    );
  });
});
