const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const dashboardPath = process.env.DASHBOARD_PATH;
if (!dashboardPath) throw new Error("DASHBOARD_PATH is required");
const html = fs.readFileSync(dashboardPath, "utf8");
const payload = JSON.parse(html.match(/<script id="dashPayload" type="application\/json">(.*?)<\/script>/s)[1]);

test.use({ channel: "chrome" });

function formatMoney(value) {
  return Number(value).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

test("B站必火+三联成本 payload 严格对账", () => {
  const sources = payload.meta.sources;
  const bili = payload.bilibili;
  const meta = bili.meta;
  const summary = bili.cost_all.summary;
  const daily = bili.cost_all.daily;
  expect(sources.bili.loaded).toBe(true);
  expect(sources.bili_fire.loaded).toBe(true);
  expect(sources.bili_ads.loaded).toBe(true);
  expect(sources.bili.path).toMatch(/星河|小红星/);
  expect(sources.bili_fire.path).toContain("必火");
  expect(sources.bili_ads.path).toContain("三联");
  expect(meta.period).toBe(sources.bili.period);
  expect(meta.source_period).toBeTruthy();
  expect(meta.effective_period).toBeTruthy();
  expect(meta.effective_end).toBeGreaterThanOrEqual(meta.effective_start);

  expect(meta.source_spend).toBeCloseTo(meta.source_bihuo_spend + meta.source_trilan_spend, 8);
  expect(meta.effective_spend).toBeCloseTo(meta.effective_bihuo_spend + meta.effective_trilan_spend, 8);
  expect(meta.source_spend).toBeCloseTo(
    meta.effective_spend
      + meta.excluded_after_cutoff_spend
      + meta.unmatched_trilan_spend
      + meta.unmatched_bihuo_spend
      + meta.ambiguous_bihuo_spend,
    8
  );
  expect(meta.paid_note_count).toBe(meta.bihuo_note_count + meta.trilan_note_count - meta.both_note_count);
  expect(meta.matched_note_count).toBeLessThanOrEqual(meta.paid_note_count);

  expect(Object.keys(bili.cost)).toHaveLength(meta.matched_note_count);
  expect(summary.note_count).toBe(meta.matched_note_count);
  expect(summary.spend).toBeCloseTo(meta.effective_spend, 8);
  expect(summary.bihuo_spend).toBeCloseTo(meta.effective_bihuo_spend, 8);
  expect(summary.trilan_spend).toBeCloseTo(meta.effective_trilan_spend, 8);
  expect(summary.roi).toBeCloseTo(summary.gmv / summary.spend, 10);
  expect(daily[0][0]).toBe(meta.effective_start);
  expect(daily.at(-1)[0]).toBe(meta.effective_end);
  expect(daily.every(row => row.length === 10)).toBe(true);
  expect(daily.reduce((sum, row) => sum + row[1], 0)).toBeCloseTo(summary.spend, 8);
  expect(daily.reduce((sum, row) => sum + row[8], 0)).toBeCloseTo(summary.bihuo_spend, 8);
  expect(daily.reduce((sum, row) => sum + row[9], 0)).toBeCloseTo(summary.trilan_spend, 8);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`B站三图顺序与交互 ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(pathToFileURL(dashboardPath).href);
    await page.locator('.platform-group-toggle[data-page="page-bili"]').click();

    const order = await page.locator("#page-bili section.module").evaluateAll(items => items.map(item => item.id));
    expect(order).toEqual(["modBiliDailyOverview", "modBiliTrend", "modBiliCost"]);
    await expect(page.locator("#biliSourceStrip .src-card")).toHaveCount(3);
    await expect(page.locator("#biliKpiRow .kpi")).toHaveCount(4);
    await expect(page.locator("#biliDailyOverviewKpis .trend-kpi")).toHaveCount(5);
    await expect(page.locator("#biliTrendKpis .trend-kpi")).toHaveCount(6);
    await expect(page.locator("#biliTrendKpis")).toContainText("总播放UV（全部）");
    const totalPlay = payload.bilibili.trends_all.reduce((sum, row) => sum + (row[5] || 0), 0);
    const playCard = page.locator("#biliTrendKpis .trend-kpi").filter({ hasText: "总播放UV（全部）" });
    await expect(playCard.locator(".trend-kpi-val")).toContainText(totalPlay.toLocaleString("zh-CN"));
    await expect(page.locator("#biliCostKpis .trend-kpi")).toHaveCount(6);
    await expect(page.locator("#biliKpiRow")).toContainText(formatMoney(payload.bilibili.meta.source_spend));
    await expect(page.locator("#biliKpiRow")).toContainText(`必火 ${formatMoney(payload.bilibili.meta.source_bihuo_spend)}`);
    await expect(page.locator("#biliCostKpis")).toContainText(`必火 ${formatMoney(payload.bilibili.cost_all.summary.bihuo_spend)}`);
    await expect(page.locator("#biliSourceStrip .data-quality-note")).toContainText(formatMoney(payload.bilibili.meta.excluded_after_cutoff_spend));
    await expect(page.locator("#biliCostSourceNote")).toContainText(payload.bilibili.meta.effective_period);

    const trendCardOverflow = await page.locator("#biliTrendKpis .trend-kpi").evaluateAll(cards => cards.some(card => {
      const box = card.getBoundingClientRect();
      return Array.from(card.children).some(child => {
        const childBox = child.getBoundingClientRect();
        return childBox.left < box.left - 1 || childBox.right > box.right + 1;
      });
    }));
    expect(trendCardOverflow).toBe(false);

    const trendNote = payload.bilibili.notes.find(note => note.play_uv > 0 && payload.bilibili.trends[note.note_id]);
    expect(trendNote).toBeTruthy();
    const trendSearch = page.locator("#biliTrendSearch");
    await trendSearch.fill(trendNote.note_id);
    await trendSearch.press("Enter");
    const singlePlayCard = page.locator("#biliTrendKpis .trend-kpi").filter({ hasText: "总播放UV" });
    await expect(page.locator("#biliTrendKpis .trend-kpi")).toHaveCount(6);
    await expect(singlePlayCard).toHaveCount(1);
    await expect(singlePlayCard.locator(".trend-kpi-val")).toContainText(trendNote.play_uv.toLocaleString("zh-CN"));

    const chartState = await page.locator("#page-bili").evaluate(() =>
      ["biliDailyOverviewChart", "biliTrendChart", "biliCostChart"].map(id => {
        const el = document.getElementById(id);
        const canvas = el.querySelector("canvas");
        return { id, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
          canvasWidth: canvas ? canvas.width : 0, canvasHeight: canvas ? canvas.height : 0 };
      })
    );
    for (const chart of chartState) {
      expect(chart.width).toBeGreaterThan(250);
      expect(chart.height).toBeGreaterThan(250);
      expect(chart.canvasWidth).toBeGreaterThan(0);
      expect(chart.canvasHeight).toBeGreaterThan(0);
    }
    await page.screenshot({
      path: path.join(__dirname, "..", "scripts", `_check_bili_${viewport.name}.png`),
      fullPage: true,
    });

    await page.locator('#biliCostToggles [data-metric="play"]').click();
    await expect(page.locator("#biliCostToggles .metric-toggle-card.active")).toHaveCount(2);
    const multiHeight = await page.locator("#biliCostChart").evaluate(el => el.getBoundingClientRect().height);
    expect(multiHeight).toBeGreaterThanOrEqual(500);

    const seriesNames = await page.locator("#biliCostChart").evaluate(el =>
      echarts.getInstanceByDom(el).getOption().series.map(series => series.name)
    );
    expect(seriesNames).toContain("必火消耗");
    expect(seriesNames).toContain("三联花费");

    const paidId = payload.bilibili.notes.find(note => note.in_bihuo && note.in_trilan).note_id;
    const search = page.locator("#biliCostSearch");
    await search.fill(paidId);
    await search.press("Enter");
    await expect(page.locator("#biliCostKpis .trend-kpi")).toHaveCount(6);
    await expect(page.locator("#biliCostKpis")).toContainText("必火");
    await expect(page.locator("#biliCostKpis")).toContainText("三联");
    const cardOverflow = await page.locator("#biliCostKpis .trend-kpi").evaluateAll(cards => cards.some(card => {
      const box = card.getBoundingClientRect();
      return Array.from(card.children).some(child => child.getBoundingClientRect().right > box.right + 1);
    }));
    expect(cardOverflow).toBe(false);

    const overflow = await page.locator("#page-bili").evaluate(el => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);
  });
}
