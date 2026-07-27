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
      /\.filter-grid\s*{[^}]*grid-template-columns:\s*1fr;/,
    );
  });

  it('defines the divider-based analytics layout and stable chart stages', () => {
    expect(rule(':root')).toMatch(/--balance:\s*#1d4ed8;/);
    expect(rule(':root')).toMatch(/--balance-soft:\s*#eff6ff;/);
    for (const token of [
      'category-blue',
      'category-green',
      'category-gold',
      'category-violet',
      'category-orange',
      'category-teal',
      'category-other',
    ]) {
      expect(rule(':root')).toContain(`--${token}:`);
    }

    expect(css).toMatch(
      /\.analytics-grid-categories\s*{[^}]*grid-template-columns/s,
    );
    expect(rule('.analytics-section')).toContain(
      'border-bottom: 1px solid var(--line);',
    );
    expect(css).not.toMatch(/\.expense-chart-layout\s*{/);
    expect(css).not.toMatch(/\.category-totals\s*{/);
    expect(css).toMatch(/\.chart-stage-balance\s*{[^}]*aspect-ratio/s);
    expect(css).toMatch(/\.chart-stage-doughnut\s*{[^}]*min-height/s);
    expect(css).toMatch(/\.chart-stage-semesters\s*{[^}]*min-height/s);
  });

  it('styles compact accessible controls, largest rows, and highlights', () => {
    expect(rule('.chart-data-toggle')).toContain('border-radius: 4px;');
    expect(css).toMatch(/\.chart-data-toggle:focus-visible\s*{/);
    expect(css).toMatch(/\.largest-list button:focus-visible\s*{/);
    expect(rule('.largest-list button')).toContain(
      'grid-template-columns: minmax(96px, 0.9fr) minmax(0, 1.8fr) minmax(0, 1.2fr) auto;',
    );
    expect(css).toMatch(/\.transaction-highlight\s*{[^}]*outline/s);
    expect(rule('.transaction-highlight')).toContain(
      'background: var(--balance-soft);',
    );
    expect(rule('.transaction-highlight td:first-child')).toContain(
      'box-shadow: inset 5px 0 0 var(--balance);',
    );
  });

  it('adapts largest rows before the comparison panel becomes narrow', () => {
    const medium = media(900);
    expect(medium).toMatch(
      /\.largest-list button\s*{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/,
    );
    expect(medium).toMatch(
      /\.largest-list strong\s*{[^}]*grid-column:\s*1 \/ -1;/,
    );
    expect(medium).toMatch(
      /\.largest-list small\s*{[^}]*grid-column:\s*1 \/ -1;/,
    );
  });

  it('stacks analytics at 720px and preserves bounded mobile chart formats', () => {
    const tablet = media(720);
    expect(tablet).toMatch(/\.analytics-grid\s*{[^}]*grid-template-columns:\s*1fr;/);
    expect(tablet).toMatch(/\.chart-stage\s*{[^}]*min-height:\s*250px;/);
    expect(tablet).toMatch(
      /\.analytics-grid > \.analytics-section \+ \.analytics-section\s*{[^}]*border-left:\s*0;/,
    );

    const mobile = media(480);
    expect(mobile).toMatch(
      /\.chart-stage-doughnut\s*{[^}]*aspect-ratio:\s*1 \/ 1;/,
    );
    expect(mobile).toMatch(
      /\.chart-stage-balance\s*{[^}]*aspect-ratio:\s*4 \/ 3;/,
    );
  });

  it('disables visual motion when reduced motion is requested', () => {
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/s);
    const reducedMotion = css.slice(
      css.indexOf('@media (prefers-reduced-motion: reduce)'),
    );
    expect(reducedMotion).toContain('scroll-behavior: auto !important;');
    expect(reducedMotion).toContain('animation-duration: 0.01ms !important;');
    expect(reducedMotion).toContain('animation-iteration-count: 1 !important;');
    expect(reducedMotion).toContain('transition-duration: 0.01ms !important;');
  });
});
