import {expect, test, type Page, type TestInfo} from '@playwright/test';

async function paintedCanvasPixels(page: Page): Promise<number> {
  await expect(page.getByRole('img', {name: '依分類統計支出'})).toBeVisible();
  await page.waitForFunction(() => {
    const canvas = document.querySelector('canvas');
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    const context = canvas.getContext('2d');
    if (context === null || canvas.width === 0 || canvas.height === 0) return false;
    const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
    for (let index = 3; index < data.length; index += 4) {
      if ((data[index] ?? 0) > 0) return true;
    }
    return false;
  });

  return page.locator('canvas').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const {data} = context.getImageData(0, 0, canvas.width, canvas.height);
    let painted = 0;
    for (let index = 3; index < data.length; index += 4) {
      if ((data[index] ?? 0) > 0) painted += 1;
    }
    return painted;
  });
}

async function expectResponsiveGeometry(page: Page) {
  const geometry = await page.evaluate(() => {
    const tolerance = 1;
    const isRendered = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0;
    };
    const outsideViewport = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < -tolerance || rect.right > innerWidth + tolerance;
    };
    const controls = [...document.querySelectorAll('input, select')].filter(isRendered);
    const text = [
      ...document.querySelectorAll(
        'h1, h2, .report-kicker, .updated-at span, .updated-at time, ' +
          '.filter-field > span, dt, dd, .section-heading > span, ' +
          '.category-totals li > span:not(.category-swatch), .category-totals strong',
      ),
    ].filter(isRendered);
    const textRects = text.map((element) => ({
      label: element.textContent?.trim() ?? element.tagName,
      rect: element.getBoundingClientRect(),
    }));
    const overlaps: string[] = [];
    for (let left = 0; left < textRects.length; left += 1) {
      for (let right = left + 1; right < textRects.length; right += 1) {
        const a = textRects[left]!;
        const b = textRects[right]!;
        if (
          Math.min(a.rect.right, b.rect.right) - Math.max(a.rect.left, b.rect.left) >
            tolerance &&
          Math.min(a.rect.bottom, b.rect.bottom) - Math.max(a.rect.top, b.rect.top) >
            tolerance
        ) {
          overlaps.push(`${a.label} / ${b.label}`);
        }
      }
    }
    const tableScroll = document.querySelector('.table-scroll');
    const table = document.querySelector('table');
    const chartStage = document.querySelector('.chart-stage');
    const categoryTotals = document.querySelector('.category-totals');
    const chartRect = chartStage?.getBoundingClientRect();
    const categoryRect = categoryTotals?.getBoundingClientRect();
    const overflowingElements = [...document.querySelectorAll('body *')]
      .filter(isRendered)
      .filter(outsideViewport)
      .filter((element) => element.closest('.table-scroll') === null)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          selector: `${element.tagName.toLowerCase()}.${element.className}`,
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });

    return {
      documentOverflow: document.documentElement.scrollWidth - innerWidth,
      outsideControls: controls
        .filter(outsideViewport)
        .map((element) => element.getAttribute('aria-label') ?? element.tagName),
      outsideText: text
        .filter(outsideViewport)
        .map((element) => element.textContent?.trim() ?? element.tagName),
      overlaps,
      tableContainerInsideViewport:
        tableScroll !== null && !outsideViewport(tableScroll),
      tableUsesExplicitOverflow:
        tableScroll !== null &&
        getComputedStyle(tableScroll).overflowX === 'auto' &&
        table !== null &&
        table.scrollWidth >= tableScroll.clientWidth,
      dateVisible: document.querySelector('th:first-child')?.textContent === '日期',
      amountVisible: [...document.querySelectorAll('th')].some(
        (heading) => heading.textContent === '金額',
      ),
      chartLegendOverlap:
        chartRect !== undefined &&
        categoryRect !== undefined &&
        Math.min(chartRect.right, categoryRect.right) -
          Math.max(chartRect.left, categoryRect.left) >
          tolerance &&
        Math.min(chartRect.bottom, categoryRect.bottom) -
          Math.max(chartRect.top, categoryRect.top) >
          tolerance,
      overflowingElements,
    };
  });

  expect(
    geometry.documentOverflow,
    JSON.stringify(geometry.overflowingElements),
  ).toBeLessThanOrEqual(1);
  expect(geometry.outsideControls).toEqual([]);
  expect(geometry.outsideText).toEqual([]);
  expect(geometry.overlaps).toEqual([]);
  expect(geometry.tableContainerInsideViewport).toBe(true);
  expect(geometry.tableUsesExplicitOverflow).toBe(true);
  expect(geometry.dateVisible).toBe(true);
  expect(geometry.amountVisible).toBe(true);
  expect(geometry.chartLegendOverlap).toBe(false);

  const boundaryColumns = await page.locator('.table-scroll').evaluate((element) => {
    const container = element as HTMLElement;
    const date = container.querySelector('th:first-child');
    const amount = [...container.querySelectorAll('th')].find(
      (heading) => heading.textContent === '金額',
    );
    const isInside = (candidate: Element | undefined | null) => {
      if (candidate === undefined || candidate === null) return false;
      const containerRect = container.getBoundingClientRect();
      const candidateRect = candidate.getBoundingClientRect();
      return (
        candidateRect.left >= containerRect.left - 1 &&
        candidateRect.right <= containerRect.right + 1
      );
    };

    container.scrollLeft = 0;
    const dateAtStart = isInside(date);
    container.scrollLeft = container.scrollWidth;
    const amountAtEnd = isInside(amount);
    container.scrollLeft = 0;
    return {dateAtStart, amountAtEnd};
  });
  expect(boundaryColumns).toEqual({dateAtStart: true, amountAtEnd: true});
}

async function attachScreenshot(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const path = testInfo.outputPath(`${name}.png`);
  await page.screenshot({path, fullPage: true});
  await testInfo.attach(name, {path, contentType: 'image/png'});
}

test('renders and filters the verified report', async ({page}, testInfo) => {
  await page.goto('/');

  await expect(page.getByRole('heading', {name: '班費收支報告'})).toBeVisible();
  const summary = page.getByRole('region', {name: '帳務摘要'});
  await expect(summary.getByText('NT$3,950')).toBeVisible();
  await expect(summary.getByText('NT$5,000')).toBeVisible();
  await expect(summary.getByText('NT$1,050')).toBeVisible();
  await expect(page.getByLabel('搜尋項目與備註')).toBeVisible();
  await expect(page.getByLabel('學期')).toBeVisible();
  await expect(page.getByLabel('經手人')).toBeVisible();
  await expect(page.getByRole('region', {name: '分類支出'})).toBeVisible();
  const table = page.getByRole('table', {name: '班費交易明細'});
  const subject = (value: string) =>
    table.locator('.subject', {hasText: new RegExp(`^${value}$`)});
  await expect(table).toBeVisible();
  await expect(subject('掃具')).toBeVisible();
  await expect(subject('影印')).toBeVisible();
  expect(await paintedCanvasPixels(page)).toBeGreaterThan(100);
  await expectResponsiveGeometry(page);
  await attachScreenshot(page, testInfo, `report-${testInfo.project.name}`);

  await page.getByLabel('經手人').selectOption('我');
  await page.getByLabel('學期').selectOption('第一學期');
  const filtered = page.getByRole('region', {name: '篩選結果'});
  await expect(filtered.getByText('NT$5,000')).toBeVisible();
  await expect(filtered.getByText('NT$350')).toBeVisible();
  await expect(filtered.getByText('NT$4,650')).toBeVisible();
  await expect(summary.getByText('NT$3,950')).toBeVisible();
  await expect(subject('期初餘額')).toBeVisible();
  await expect(subject('影印')).toBeVisible();
  await expect(subject('掃具')).toHaveCount(0);
  await expect(table.getByRole('row')).toHaveCount(3);

  await page.getByLabel('日期排序').selectOption('oldest');
  await expect(table.locator('.subject')).toHaveText(['期初餘額', '影印']);
  expect(await paintedCanvasPixels(page)).toBeGreaterThan(100);
  await expectResponsiveGeometry(page);
  await attachScreenshot(page, testInfo, `report-${testInfo.project.name}-filtered`);
});

test('keeps the responsive boundary free of page overflow and overlap', async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'covered once outside mobile project');

  for (const width of [768, 721, 600]) {
    await page.setViewportSize({width, height: 900});
    await page.goto('/');
    await expectResponsiveGeometry(page);
    expect(await paintedCanvasPixels(page)).toBeGreaterThan(100);
    await attachScreenshot(page, testInfo, `report-${width}`);
  }
});
