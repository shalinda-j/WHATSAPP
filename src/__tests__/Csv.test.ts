import { toCsv, csvDownloadHeaders } from '../server/utils/csv';

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
