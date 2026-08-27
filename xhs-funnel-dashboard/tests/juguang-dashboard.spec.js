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

test("聚光与双渠道成本 payload 对账", () => {
  const summary = payload.summary;
  const source = payload.meta.sources.juguang;
  const cost = payload.cost_all.summary;
  expect(source.loaded).toBe(true);
  expect(source.path).toContain("聚光");
  expect(source.path.split(" · ").length).toBeGreaterThanOrEqual(1);
  expect(source.valid_rows).toBe(source.rows - source.summary_rows - source.invalid_rows);
  expect(source.summary_rows).toBeGreaterThanOrEqual(0);
  expect(Math.abs(source.summary_diff)).toBeLessThanOrEqual(0.1);
  expect(summary.total_spend).toBeCloseTo(summary.total_chili_spend + summary.total_juguang_spend, 8);
  expect(summary.paid_note_count).toBe(summary.chili_note_count + summary.juguang_note_count - summary.both_note_count);
  expect(summary.matched_note_count).toBeLessThanOrEqual(summary.paid_note_count);
  expect(summary.matched_spend).toBeCloseTo(cost.spend, 8);
  expect(summary.matched_gmv).toBeCloseTo(cost.gmv, 8);
  expect(cost.spend).toBeCloseTo(cost.chili_spend + cost.juguang_spend, 8);
  expect(cost.note_count).toBe(summary.matched_note_count);
  expect(summary.overall_roi).toBeCloseTo(summary.matched_gmv / summary.matched_spend, 10);
  expect(payload.cost_all.daily.at(-1)[0]).toBe(summary.star_cost_cutoff);
  expect(payload.cost_all.daily.every(row => row.length === 10)).toBe(true);
  expect(payload.cost_all.daily.reduce((sum, row) => sum + row[1], 0)).toBeCloseTo(cost.spend, 8);
  expect(payload.cost_all.daily.reduce((sum, row) => sum + row[8], 0)).toBeCloseTo(cost.chili_spend, 8);
  expect(payload.cost_all.daily.reduce((sum, row) => sum + row[9], 0)).toBeCloseTo(cost.juguang_spend, 8);
  expect(payload.notes.every(note => Math.abs((note.chili_spend || 0) + (note.juguang_spend || 0) - (note.spend || 0)) < 0.001)).toBe(true);
});

for (const viewport of [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
]) {
  test(`聚光前端与红色双渠道成本 ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto(pathToFileURL(dashboardPath).href);
    await expect(page.locator("#sourceStrip .src-card")).toHaveCount(5);
    await expect(page.locator("#kpiRow .kpi")).toHaveCount(4);
    await expect(page.locator("#kpiRow")).toContainText(formatMoney(payload.summary.total_spend));
    await expect(page.locator("#kpiRow")).toContainText(`聚光 ${formatMoney(payload.summary.total_juguang_spend)}`);
    await expect(page.locator("#sourceStrip .data-quality-note")).toContainText(formatMoney(payload.summary.waiting_attribution_spend));
    await expect(page.locator("#sourceStrip .data-quality-note")).toContainText(formatMoney(payload.meta.sources.juguang.summary_diff));
    await expect(page.locator("#costKpis .trend-kpi")).toHaveCount(6);
    await expect(page.locator("#costKpis")).toContainText(`聚光 ${formatMoney(payload.cost_all.summary.juguang_spend)}`);
    const summaryCardOverflow = await page.locator("#costKpis .trend-kpi").evaluateAll(cards => cards.some(card => {
      const box = card.getBoundingClientRect();
      return Array.from(card.children).some(child => {
        const rect = child.getBoundingClientRect();
        return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.bottom > box.bottom + 1;
      });
    }));
    expect(summaryCardOverflow).toBe(false);
    await expect(page.locator("#costSourceNote")).toContainText("聚光");

    const groups = await page.locator("#tableHead .group-row th").allTextContents();
    expect(groups).toContain("投放汇总");
    expect(groups).toContain("薯条投放");
    expect(groups).toContain("聚光投放");
    const chart = await page.locator("#costChart").evaluate(el => {
      const canvas = el.querySelector("canvas");
      return { width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height,
        canvasWidth: canvas ? canvas.width : 0, canvasHeight: canvas ? canvas.height : 0 };
    });
    expect(chart.width).toBeGreaterThan(250);
    expect(chart.height).toBeGreaterThan(250);
    expect(chart.canvasWidth).toBeGreaterThan(0);
    expect(chart.canvasHeight).toBeGreaterThan(0);

    const paidBoth = payload.notes.find(note => note.in_chili && note.in_juguang && payload.cost[note.note_id]);
    expect(paidBoth).toBeTruthy();
    const search = page.locator("#costSearch");
    await search.fill(paidBoth.note_id);
    await search.press("Enter");
    await expect(page.locator("#costKpis .trend-kpi")).toHaveCount(6);
    await expect(page.locator("#costKpis")).toContainText("薯条");
    await expect(page.locator("#costKpis")).toContainText("聚光");
    await expect(page.locator("#costKpis .trend-kpi-sub")).toHaveCount(6);
    const singleCardOverflow = await page.locator("#costKpis .trend-kpi").evaluateAll(cards => cards.some(card => {
      const box = card.getBoundingClientRect();
      return Array.from(card.children).some(child => {
        const rect = child.getBoundingClientRect();
        return rect.left < box.left - 1 || rect.right > box.right + 1 || rect.bottom > box.bottom + 1;
      });
    }));
    expect(singleCardOverflow).toBe(false);
    await page.locator("#costKpis").screenshot({
      path: path.join(__dirname, "..", "scripts", `_check_cost_kpis_${viewport.name}.png`),
    });
    const overflow = await page.locator("#page-xhs").evaluate(el => el.scrollWidth > el.clientWidth + 1);
    expect(overflow).toBe(false);

    await page.screenshot({
      path: path.join(__dirname, "..", "scripts", `_check_juguang_${viewport.name}.png`),
      fullPage: true,
    });
  });
}
