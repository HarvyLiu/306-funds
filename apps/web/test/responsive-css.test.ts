import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';

import {describe, expect, it} from 'vitest';

const css = readFileSync(
  resolve(process.cwd(), 'src/styles/global.css'),
  'utf8',
);

function rule(selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `Missing ${selector} rule`).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end, `Unclosed ${selector} rule`).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

function media(maxWidth: number): string {
  const start = css.indexOf(`@media (max-width: ${maxWidth}px)`);
  expect(start, `Missing ${maxWidth}px breakpoint`).toBeGreaterThanOrEqual(0);
  const next = css.indexOf('\n@media ', start + 1);
  return css.slice(start, next === -1 ? undefined : next);
}

describe('responsive report CSS', () => {
  it('uses shrinkable desktop filter tracks and shrinkable controls', () => {
    const desktopGrid = rule('.filter-grid');
    expect(desktopGrid).toContain(
      'grid-template-columns: minmax(0, 2fr) repeat(5, minmax(0, 1fr));',
    );
    expect(desktopGrid).not.toMatch(/minmax\(\d+px,/);

    const field = rule('.filter-field');
    expect(field).toContain('width: 100%;');
    expect(field).toContain('max-width: 100%;');
    expect(field).toContain('min-width: 0;');
    expect(rule('.filter-field > span')).toContain('overflow-wrap: anywhere;');
    const controls = rule('.filter-field input,\n.filter-field select');
    expect(controls).toContain('width: 100%;');
    expect(controls).toContain('max-width: 100%;');
    expect(controls).toContain('min-width: 0;');
  });

  it('preserves two filter columns at 720px and one at 480px', () => {
    expect(media(720)).toMatch(
      /\.filter-grid\s*{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/,
    );
    expect(media(480)).toMatch(
      /\.filter-grid,[^}]*grid-template-columns:\s*1fr;/,
    );
  });
});
