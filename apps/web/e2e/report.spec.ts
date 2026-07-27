import {expect, test, type Page, type TestInfo} from '@playwright/test';

const canvasNames = [
  '總餘額走勢圖',
  '分類支出比例圖',
  '分類收入比例圖',
  '各學期收支比較圖',
] as const;

const expectedLedger = {
  full: {income: 6800, expenses: 3000, balance: 3800},
  firstSemester: {income: 5600, expenses: 2400, opening: 0, ending: 3200},
  secondSemester: {
    income: 1200,
    expenses: 600,
    opening: 3200,
    ending: 3800,
  },
  secondSemesterOfficerFilter: {income: 800, expenses: 250, net: 550},
} as const;

interface BalancePointGeometry {
  x: number;
  y: number;
  radius: number;
  style: 'circle' | 'rectRot';
}

async function paintedCanvasPixels(page: Page, name: string): Promise<number> {
  const canvas = page.getByRole('img', {name});
  await expect(canvas).toBeVisible();

  const countPixels = () =>
    canvas.evaluate((element) => {
      const chartCanvas = element as HTMLCanvasElement;
      const context = chartCanvas.getContext('2d');
      if (
        context === null ||
        chartCanvas.width === 0 ||
        chartCanvas.height === 0
      ) {
        return 0;
      }
      const {data} = context.getImageData(
        0,
        0,
        chartCanvas.width,
        chartCanvas.height,
      );
      let painted = 0;
      for (let index = 3; index < data.length; index += 4) {
        if ((data[index] ?? 0) > 0) painted += 1;
      }
      return painted;
    });

  await expect.poll(countPixels).toBeGreaterThan(100);
  return countPixels();
}

async function installBalanceGeometryProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    interface ProbedPath {
      arcs: Array<{x: number; y: number; radius: number}>;
      vertices: Array<{x: number; y: number}>;
    }

    const probedWindow = window as typeof window & {
      __balancePointGeometry: BalancePointGeometry[];
    };
    probedWindow.__balancePointGeometry = [];
    const paths = new WeakMap<CanvasRenderingContext2D, ProbedPath>();
    const isBalanceCanvas = (context: CanvasRenderingContext2D) =>
      context.canvas.getAttribute('aria-label') === '總餘額走勢圖';
    const normalize = (value: number) => Math.round(value * 1000) / 1000;
    const recordPoint = (
      context: CanvasRenderingContext2D,
      point: BalancePointGeometry,
    ) => {
      if (
        !isBalanceCanvas(context) ||
        String(context.fillStyle).toLowerCase() !== '#1d4ed8'
      ) {
        return;
      }

      const normalized = {
        x: normalize(point.x),
        y: normalize(point.y),
        radius: normalize(point.radius),
        style: point.style,
      };
      const duplicate = probedWindow.__balancePointGeometry.some(
        (candidate) =>
          candidate.x === normalized.x &&
          candidate.y === normalized.y &&
          candidate.radius === normalized.radius &&
          candidate.style === normalized.style,
      );
      if (!duplicate) probedWindow.__balancePointGeometry.push(normalized);
    };

    const originalClearRect = CanvasRenderingContext2D.prototype.clearRect;
    CanvasRenderingContext2D.prototype.clearRect = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
      width: number,
      height: number,
    ) {
      if (isBalanceCanvas(this)) {
        probedWindow.__balancePointGeometry = [];
        paths.delete(this);
      }
      return originalClearRect.call(this, x, y, width, height);
    };

    const originalBeginPath = CanvasRenderingContext2D.prototype.beginPath;
    CanvasRenderingContext2D.prototype.beginPath = function (
      this: CanvasRenderingContext2D,
    ) {
      if (isBalanceCanvas(this)) {
        paths.set(this, {arcs: [], vertices: []});
      }
      return originalBeginPath.call(this);
    };

    const originalArc = CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
      radius: number,
      startAngle: number,
      endAngle: number,
      counterclockwise?: boolean,
    ) {
      paths.get(this)?.arcs.push({x, y, radius});
      return originalArc.call(
        this,
        x,
        y,
        radius,
        startAngle,
        endAngle,
        counterclockwise,
      );
    };

    const originalMoveTo = CanvasRenderingContext2D.prototype.moveTo;
    CanvasRenderingContext2D.prototype.moveTo = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
    ) {
      paths.get(this)?.vertices.push({x, y});
      return originalMoveTo.call(this, x, y);
    };

    const originalLineTo = CanvasRenderingContext2D.prototype.lineTo;
    CanvasRenderingContext2D.prototype.lineTo = function (
      this: CanvasRenderingContext2D,
      x: number,
      y: number,
    ) {
      paths.get(this)?.vertices.push({x, y});
      return originalLineTo.call(this, x, y);
    };

    const originalFill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (
      this: CanvasRenderingContext2D,
      pathOrRule?: Path2D | CanvasFillRule,
      fillRule?: CanvasFillRule,
    ) {
      const path = paths.get(this);
      const arc = path?.arcs[0];
      if (
        path?.arcs.length === 1 &&
        path.vertices.length === 0 &&
        arc !== undefined
      ) {
        const {x, y, radius} = arc;
        recordPoint(this, {x, y, radius, style: 'circle'});
      } else if (path?.arcs.length === 0 && path.vertices.length === 4) {
        const xs = path.vertices.map(({x}) => x);
        const ys = path.vertices.map(({y}) => y);
        const left = Math.min(...xs);
        const right = Math.max(...xs);
        const top = Math.min(...ys);
        const bottom = Math.max(...ys);
        recordPoint(this, {
          x: (left + right) / 2,
          y: (top + bottom) / 2,
          radius: Math.max(right - left, bottom - top) / 2,
          style: 'rectRot',
        });
      }

      const fillArguments =
        pathOrRule === undefined
          ? []
          : fillRule === undefined
            ? [pathOrRule]
            : [pathOrRule, fillRule];
      Reflect.apply(originalFill, this, fillArguments);
    };
  });
}

async function balancePointGeometry(
  page: Page,
): Promise<BalancePointGeometry[]> {
  const readGeometry = () =>
    page.evaluate(() => {
      const probedWindow = window as typeof window & {
        __balancePointGeometry?: BalancePointGeometry[];
      };
      return [...(probedWindow.__balancePointGeometry ?? [])].sort(
        (left, right) => left.x - right.x,
      );
    });

  await expect
    .poll(async () => (await readGeometry()).length)
    .toBeGreaterThan(0);
  return readGeometry();
}

async function pagePoint(
  page: Page,
  geometry: BalancePointGeometry,
): Promise<{x: number; y: number}> {
  const canvas = page.getByRole('img', {name: '總餘額走勢圖'});
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  if (box === null) {
    throw new Error('Balance chart canvas has no rendered geometry');
  }

  return {x: box.x + geometry.x, y: box.y + geometry.y};
}

async function tapAt(page: Page, point: {x: number; y: number}): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{x: point.x, y: point.y}],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchEnd',
      touchPoints: [],
    });
  } finally {
    await session.detach();
  }
}

async function installScrollBehaviorProbe(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const probedWindow = window as typeof window & {
      __scrollBehaviors: Array<ScrollBehavior | undefined>;
    };
    probedWindow.__scrollBehaviors = [];
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = function (
      this: HTMLElement,
      options?: boolean | ScrollIntoViewOptions,
    ) {
      probedWindow.__scrollBehaviors.push(
        typeof options === 'object' ? options.behavior : undefined,
      );
      return originalScrollIntoView.call(this, options);
    };
  });
}

async function expectAllCanvasesPainted(page: Page): Promise<void> {
  for (const name of canvasNames) {
    expect(await paintedCanvasPixels(page, name)).toBeGreaterThan(100);
  }
}

async function discloseChartTable(
  page: Page,
  regionName: string,
  tableName: string,
) {
  const region = page.getByRole('region', {name: regionName});
  const toggle = region.locator('.chart-data-toggle');
  await expect(toggle).toHaveAccessibleName('查看資料表');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const table = page.getByRole('table', {name: tableName});
  await expect(table).toBeVisible();
  return table;
}

async function expectResponsiveGeometry(page: Page) {
  const closedDisclosures = page.locator(
    '.chart-data-toggle[aria-expanded="false"]',
  );
  while ((await closedDisclosures.count()) > 0) {
    await closedDisclosures.first().click();
  }

  const geometry = await page.evaluate(() => {
    const tolerance = 1;
    const isRendered = (element: Element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return (
        style.display !== 'none' &&
        style.visibility !== 'hidden' &&
        rect.width > 0
      );
    };
    const outsideViewport = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return rect.left < -tolerance || rect.right > innerWidth + tolerance;
    };
    const controls = [
      ...document.querySelectorAll(
        'input, select, .chart-data-toggle, .largest-list button',
      ),
    ].filter(isRendered);
    const text = [
      ...document.querySelectorAll(
        'h1, h2, .report-kicker, .updated-at span, .updated-at time, ' +
          '.filter-field > span, dt, dd, .section-heading > span, ' +
          '.chart-data-toggle, .largest-list span, .largest-list strong, ' +
          '.largest-list small, .largest-list b, .chart-data th, .chart-data td, ' +
          '.semester-opening strong, .semester-opening span, .semester-opening .amount-column',
      ),
    ].filter(isRendered);
    const visibleRect = (element: Element) => {
      const rect = element.getBoundingClientRect();
      const scrollContainer = element.closest(
        '.table-scroll, .chart-data-scroll',
      );
      if (scrollContainer === null) return rect;

      const containerRect = scrollContainer.getBoundingClientRect();
      return {
        left: Math.max(rect.left, containerRect.left),
        right: Math.min(rect.right, containerRect.right),
        top: Math.max(rect.top, containerRect.top),
        bottom: Math.min(rect.bottom, containerRect.bottom),
      };
    };
    const textRects = text
      .map((element) => ({
        label: element.textContent?.trim() ?? element.tagName,
        rect: visibleRect(element),
      }))
      .filter(
        ({rect}) =>
          rect.right - rect.left > tolerance &&
          rect.bottom - rect.top > tolerance,
      );
    const overlaps: string[] = [];
    for (let left = 0; left < textRects.length; left += 1) {
      for (let right = left + 1; right < textRects.length; right += 1) {
        const a = textRects[left]!;
        const b = textRects[right]!;
        if (
          Math.min(a.rect.right, b.rect.right) -
            Math.max(a.rect.left, b.rect.left) >
            tolerance &&
          Math.min(a.rect.bottom, b.rect.bottom) -
            Math.max(a.rect.top, b.rect.top) >
            tolerance
        ) {
          overlaps.push(`${a.label} / ${b.label}`);
        }
      }
    }
    const tableScroll = document.querySelector('.table-scroll');
    const table = tableScroll?.querySelector('table') ?? null;
    const chartRegions = [
      ...document.querySelectorAll('.analytics-section > .analytics-chart'),
    ].filter(isRendered);
    const chartRegionOutputs = chartRegions.map((region) =>
      [...region.children].filter(
        (element) =>
          element.matches('.chart-stage, .analytics-empty') &&
          isRendered(element),
      ),
    );
    const chartOutputs = chartRegionOutputs.flat();
    const chartStages = [...document.querySelectorAll('.chart-stage')].filter(
      isRendered,
    );
    const chartToggles = [
      ...document.querySelectorAll('.chart-data-toggle'),
    ].filter(isRendered);
    const largestButtons = [
      ...document.querySelectorAll('.largest-list button'),
    ].filter(isRendered);
    const analyticsHeadings = [
      ...document.querySelectorAll('.analytics-section .section-heading'),
    ].filter(isRendered);
    const chartDataScrolls = [
      ...document.querySelectorAll('.chart-data-scroll'),
    ].filter(isRendered);
    const isInsideScrollContainer = (element: Element) =>
      element.closest('.table-scroll, .chart-data-scroll') !== null;
    const overflowingElements = [...document.querySelectorAll('body *')]
      .filter(isRendered)
      .filter(outsideViewport)
      .filter((element) => !isInsideScrollContainer(element))
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
        .map(
          (element) => element.getAttribute('aria-label') ?? element.tagName,
        ),
      outsideText: text
        .filter(outsideViewport)
        .filter((element) => !isInsideScrollContainer(element))
        .map((element) => element.textContent?.trim() ?? element.tagName),
      overlaps,
      tableContainerInsideViewport:
        tableScroll !== null && !outsideViewport(tableScroll),
      tableUsesExplicitOverflow:
        tableScroll !== null &&
        getComputedStyle(tableScroll).overflowX === 'auto' &&
        table !== null,
      dateVisible:
        document.querySelector('th:first-child')?.textContent === '日期',
      amountVisible: [...document.querySelectorAll('th')].some(
        (heading) => heading.textContent === '金額',
      ),
      chartRegionCount: chartRegions.length,
      chartRegionsHaveSingleOutput: chartRegionOutputs.every(
        (outputs) => outputs.length === 1,
      ),
      chartOutputCount: chartOutputs.length,
      chartOutputsInsideViewport: chartOutputs.every(
        (output) => !outsideViewport(output),
      ),
      chartOutputsHaveStableSize: chartOutputs.every((output) => {
        const rect = output.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height >= 240 &&
          (innerWidth > 720 || rect.height <= 360 + tolerance)
        );
      }),
      chartStagesInsideViewport: chartStages.every(
        (stage) => !outsideViewport(stage),
      ),
      chartStagesHaveStableSize: chartStages.every((stage) => {
        const rect = stage.getBoundingClientRect();
        return rect.width > 0 && rect.height >= 240;
      }),
      chartStagesContainCanvas: chartStages.every(
        (stage) => stage.querySelector(':scope > canvas') !== null,
      ),
      chartToggleCount: chartToggles.length,
      chartTogglesInsideViewport: chartToggles.every(
        (toggle) => !outsideViewport(toggle),
      ),
      largestButtonCount: largestButtons.length,
      largestButtonsInsideViewport: largestButtons.every(
        (button) => !outsideViewport(button),
      ),
      analyticsHeadingCount: analyticsHeadings.length,
      analyticsHeadingsInsideViewport: analyticsHeadings.every(
        (heading) => !outsideViewport(heading),
      ),
      chartDataTableCount: chartDataScrolls.length,
      chartDataTablesInsideViewport: chartDataScrolls.every(
        (container) => !outsideViewport(container),
      ),
      chartDataTablesUseExplicitOverflow: chartDataScrolls.every(
        (container) =>
          getComputedStyle(container).overflowX === 'auto' &&
          container.querySelector('table') !== null,
      ),
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
  expect(geometry.chartRegionCount).toBe(4);
  expect(geometry.chartRegionsHaveSingleOutput).toBe(true);
  expect(geometry.chartOutputCount).toBe(4);
  expect(geometry.chartOutputsInsideViewport).toBe(true);
  expect(geometry.chartOutputsHaveStableSize).toBe(true);
  expect(geometry.chartStagesInsideViewport).toBe(true);
  expect(geometry.chartStagesHaveStableSize).toBe(true);
  expect(geometry.chartStagesContainCanvas).toBe(true);
  expect(geometry.chartToggleCount).toBe(4);
  expect(geometry.chartTogglesInsideViewport).toBe(true);
  expect(geometry.largestButtonCount).toBeGreaterThan(0);
  expect(geometry.largestButtonsInsideViewport).toBe(true);
  expect(geometry.analyticsHeadingCount).toBe(5);
  expect(geometry.analyticsHeadingsInsideViewport).toBe(true);
  expect(geometry.chartDataTableCount).toBe(4);
  expect(geometry.chartDataTablesInsideViewport).toBe(true);
  expect(geometry.chartDataTablesUseExplicitOverflow).toBe(true);

  const boundaryColumns = await page
    .locator('.table-scroll')
    .evaluate((element) => {
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

test('renders every analytics canvas and exercises search, category, and date filters', async ({
  page,
}, testInfo) => {
  await page.goto('/');

  await expect(page.getByRole('heading', {name: '班費收支報告'})).toBeVisible();
  const summary = page.getByRole('region', {name: '帳務摘要'});
  await expect(
    summary.getByText(
      `NT$${expectedLedger.full.balance.toLocaleString('en-US')}`,
    ),
  ).toBeVisible();
  await expect(
    summary.getByText(
      `NT$${expectedLedger.full.income.toLocaleString('en-US')}`,
    ),
  ).toBeVisible();
  await expect(
    summary.getByText(
      `NT$${expectedLedger.full.expenses.toLocaleString('en-US')}`,
    ),
  ).toBeVisible();
  await expectAllCanvasesPainted(page);
  await attachScreenshot(page, testInfo, `report-${testInfo.project.name}`);

  const table = page.getByRole('table', {name: '班費交易明細'});
  const subject = (value: string) =>
    table.locator('.subject', {hasText: new RegExp(`^${value}$`)});
  const search = page.getByRole('searchbox', {name: '搜尋項目與備註'});
  await search.fill('同日採買');
  await expect(subject('校外交通')).toBeVisible();
  await expect(table.locator('.subject')).toHaveCount(1);

  await page.getByRole('combobox', {name: '分類'}).selectOption('交通用品');
  await expect(subject('校外交通')).toBeVisible();
  await search.fill('');
  await page.getByRole('combobox', {name: '分類'}).selectOption('');
  await page.getByRole('combobox', {name: '日期排序'}).selectOption('oldest');
  await expect(table.locator('.subject').first()).toHaveText('班費收入');
  await expectResponsiveGeometry(page);
});

test('shows explicitly calculated semester openings and endings', async ({
  page,
}) => {
  await page.goto('/');
  const table = page.getByRole('table', {name: '班費交易明細'});
  const semesterSelect = page.getByRole('combobox', {name: '學期'});

  await semesterSelect.selectOption('第一學期');
  await expect(
    table.getByRole('row', {
      name: `第一學期 期初結餘 NT$${expectedLedger.firstSemester.opening}`,
    }),
  ).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(8);

  await semesterSelect.selectOption('第二學期');
  await expect(
    table.getByRole('row', {
      name: `第二學期 期初結餘 NT$${expectedLedger.secondSemester.opening.toLocaleString('en-US')}`,
    }),
  ).toBeVisible();
  await expect(table.getByRole('row')).toHaveCount(7);

  const comparison = await discloseChartTable(
    page,
    '各學期收支比較',
    '各學期收支比較資料',
  );
  await expect(
    comparison.getByRole('row', {
      name: '第二學期 NT$1,200 NT$600 NT$3,200 NT$3,800',
      exact: true,
    }),
  ).toBeVisible();
});

test('reveals one balance point through hover on desktop and tap on mobile', async ({
  page,
}, testInfo) => {
  await installBalanceGeometryProbe(page);
  await page.goto('/');
  await page.getByRole('combobox', {name: '學期'}).selectOption('第二學期');
  await page.getByRole('combobox', {name: '經手人'}).selectOption('另一位總務');

  const filteredSummary = page.getByRole('region', {name: '篩選結果'});
  for (const [label, amount] of [
    ['篩選收入', expectedLedger.secondSemesterOfficerFilter.income],
    ['篩選支出', expectedLedger.secondSemesterOfficerFilter.expenses],
    ['篩選淨額', expectedLedger.secondSemesterOfficerFilter.net],
  ] as const) {
    await expect(
      filteredSummary
        .getByText(label)
        .locator('..')
        .getByText(`NT$${amount.toLocaleString('en-US')}`),
    ).toBeVisible();
  }

  await expect
    .poll(async () => (await balancePointGeometry(page)).length)
    .toBe(6);
  const target = (await balancePointGeometry(page)).find(
    ({radius, style}) => radius === 2 && style === 'circle',
  );
  expect(target).toBeDefined();
  const point = await pagePoint(page, target!);

  if (testInfo.project.name === 'mobile') {
    await tapAt(page, point);
  } else {
    await page.mouse.move(point.x, point.y);
  }

  const detail = page.locator('output.chart-detail');
  await expect(detail).toBeVisible();
  await expect(detail).toHaveText(
    '2027-02-02 義賣收入 +NT$400，餘額 NT$4,400',
  );
});

test('keeps every semester point while secondary filters use small circles', async ({
  page,
}) => {
  await installBalanceGeometryProbe(page);
  await page.goto('/');
  await page.getByRole('combobox', {name: '學期'}).selectOption('第二學期');
  await page.getByRole('combobox', {name: '經手人'}).selectOption('另一位總務');

  await expect
    .poll(async () => (await balancePointGeometry(page)).length)
    .toBe(6);
  const renderedPoints = await balancePointGeometry(page);
  expect(renderedPoints).toHaveLength(6);
  expect(
    renderedPoints.filter(
      ({radius, style}) => radius === 2 && style === 'circle',
    ),
  ).toHaveLength(3);
  expect(
    renderedPoints.filter(
      ({radius, style}) => radius === 5 && style === 'rectRot',
    ),
  ).toHaveLength(3);

  const balanceTable = await discloseChartTable(
    page,
    '總餘額走勢',
    '總餘額走勢資料',
  );
  await expect(balanceTable.getByRole('row')).toHaveCount(7);
  await expect(
    balanceTable.getByRole('row', {
      name: '2027-02-02 義賣收入 +NT$400 NT$4,400 不符合目前次要篩選',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    balanceTable.getByRole('row', {
      name: '2027-02-03 比賽獎品 -NT$250 NT$4,150 符合目前篩選',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('table', {name: '班費交易明細'}).getByRole('row'),
  ).toHaveCount(4);
});

test('reveals every exact chart data table using only the keyboard', async ({
  page,
}) => {
  await page.goto('/');

  const balance = await discloseChartTable(
    page,
    '總餘額走勢',
    '總餘額走勢資料',
  );
  await expect(balance.getByRole('row')).toHaveCount(12);
  await expect(
    balance.getByRole('row', {
      name: '2026-08-01 班費收入 +NT$5,000 NT$5,000 符合目前篩選',
      exact: true,
    }),
  ).toBeVisible();
  await expect(balance.getByRole('row').nth(9)).toHaveAccessibleName(
    '2027-02-03 比賽獎品 -NT$250 NT$4,150 符合目前篩選',
  );
  await expect(balance.getByRole('row').nth(10)).toHaveAccessibleName(
    '2027-02-03 校外交通 -NT$200 NT$3,950 符合目前篩選',
  );

  const expenses = await discloseChartTable(
    page,
    '分類支出比例',
    '分類支出比例資料',
  );
  await expect(expenses.getByRole('row')).toHaveCount(7);
  await expect(
    expenses.getByRole('row', {
      name: '其他（彙整） NT$350 11.7% 2 筆 交通用品、餐飲用品',
      exact: true,
    }),
  ).toBeVisible();

  const income = await discloseChartTable(
    page,
    '分類收入比例',
    '分類收入比例資料',
  );
  await expect(income.getByRole('row')).toHaveCount(3);
  await expect(
    income.getByRole('row', {
      name: '班費收入 NT$5,800 85.3% 2 筆 班費收入',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    income.getByRole('row', {
      name: '義賣收入 NT$1,000 14.7% 2 筆 義賣收入',
      exact: true,
    }),
  ).toBeVisible();

  const semesters = await discloseChartTable(
    page,
    '各學期收支比較',
    '各學期收支比較資料',
  );
  await expect(semesters.getByRole('row')).toHaveCount(3);
  await expect(
    semesters.getByRole('row', {
      name: '第一學期 NT$5,600 NT$2,400 NT$0 NT$3,200',
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    semesters.getByRole('row', {
      name: '第二學期 NT$1,200 NT$600 NT$3,200 NT$3,800',
      exact: true,
    }),
  ).toBeVisible();
});

test('focuses and highlights a transaction selected with Enter', async ({
  page,
}) => {
  await page.goto('/');
  const button = page.getByRole('button', {
    name: '2026-08-01 班費收入 班費收入 +NT$5,000',
  });
  await button.focus();
  await page.keyboard.press('Enter');

  const row = page.locator('#transaction-6ed1a6b4-1ca2-45ce-91a3-2f53e5560401');
  await expect(row).toBeFocused();
  await expect(row).toHaveClass('transaction-highlight');
});

test('uses automatic row scrolling when reduced motion is requested', async ({
  page,
}) => {
  await page.emulateMedia({reducedMotion: 'reduce'});
  await installScrollBehaviorProbe(page);
  await page.goto('/');
  const button = page.getByRole('button', {
    name: '2026-08-06 影印講義 教材與影印 -NT$900',
  });
  await button.focus();
  await page.keyboard.press('Enter');

  await expect
    .poll(() =>
      page.evaluate(() => {
        const probedWindow = window as typeof window & {
          __scrollBehaviors?: Array<ScrollBehavior | undefined>;
        };
        return probedWindow.__scrollBehaviors ?? [];
      }),
    )
    .toContain('auto');
  await expect(
    page.locator('#transaction-6ed1a6b4-1ca2-45ce-91a3-2f53e5560403'),
  ).toBeFocused();
});

test('shows the expense empty state when filtering to income only', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('combobox', {name: '類型'}).selectOption('income');

  const expenseRegion = page.getByRole('region', {name: '分類支出比例'});
  await expect(expenseRegion.getByText('目前沒有支出資料')).toBeVisible();
  await expect(
    expenseRegion.getByRole('img', {name: '分類支出比例圖'}),
  ).toHaveCount(0);
  await expect(page.getByRole('img', {name: '分類收入比例圖'})).toBeVisible();
  const filtered = page.getByRole('region', {name: '篩選結果'});
  await expect(
    filtered.getByText('篩選收入').locator('..').getByText('NT$6,800'),
  ).toBeVisible();
  await expect(
    filtered.getByText('篩選支出').locator('..').getByText('NT$0'),
  ).toBeVisible();
});

test('keeps the responsive boundary free of page overflow and overlap', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop',
    'covered once outside mobile project',
  );

  for (const width of [1280, 768, 721, 600, 390, 320]) {
    await page.setViewportSize({width, height: 900});
    await page.goto('/');
    await expectResponsiveGeometry(page);
    await attachScreenshot(page, testInfo, `report-${width}`);
  }
});
