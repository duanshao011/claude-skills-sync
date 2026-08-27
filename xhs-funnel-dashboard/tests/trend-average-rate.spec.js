const { test, expect } = require("@playwright/test");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const dashboardPath = process.env.DASHBOARD_PATH;
const html = fs.readFileSync(dashboardPath, "utf8");
const payload = JSON.parse(html.match(/<script id="dashPayload" type="application\/json">(.*?)<\/script>/s)[1]);
const noteId = Object.keys(payload.trends || {}).find(id => {
  const note = payload.notes.find(item => item.note_id === id);
  return note && note.read_uv_funnel > 0 && note.visit_uv > 0;
});
const rateSpecs = [
  { key: "visit_rate", numerator: "visit_uv", denominator: "read_uv_funnel" },
  { key: "cart_rate", numerator: "cart_uv", denominator: "visit_uv" },
  { key: "deal_rate", numerator: "deal_uv", denominator: "visit_uv" },
];

function arithmeticMean(key) {
  const values = payload.notes.map(note => note[key]).filter(Number.isFinite);
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function expectedClass(current, average) {
  const diffInPercentagePoints = (current - average) * 100;
  if (Math.abs(diffInPercentagePoints) < 0.005) return "is-neutral";
  return diffInPercentagePoints > 0 ? "is-good" : "is-bad";
}

test.use({ channel: "chrome" });

test.describe("single-note conversion-rate comparison", () => {
  for (const viewport of [
    { name: "desktop", width: 1440, height: 900 },
    { name: "mobile", width: 390, height: 844 },
  ]) {
    test(viewport.name, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.goto(pathToFileURL(dashboardPath).href);

      expect(noteId).toBeTruthy();
      await expect(page.locator("#trendKpis .trend-kpi")).toHaveCount(6);
      const totalRead = payload.trends_all.reduce((sum, row) => sum + (row[5] || 0), 0);
      const readCard = page.locator("#trendKpis .trend-kpi").filter({ hasText: "总阅读UV（全部）" });
      await expect(readCard).toHaveCount(1);
      await expect(readCard.locator(".trend-kpi-val")).toContainText(totalRead.toLocaleString("zh-CN"));
      const summaryOverflow = await page.locator("#trendKpis .trend-kpi").evaluateAll(items =>
        items.some(item => {
          const box = item.getBoundingClientRect();
          return Array.from(item.children).some(child => {
            const childBox = child.getBoundingClientRect();
            return childBox.left < box.left - 1 || childBox.right > box.right + 1;
          });
        })
      );
      expect(summaryOverflow).toBe(false);
      await page.screenshot({
        path: path.join(__dirname, "..", "scripts", `_check_trend_summary_${viewport.name}.png`),
        fullPage: true,
      });

      const search = page.locator("#trendSearch");
      await search.fill(noteId);
      await search.press("Enter");
      const cards = page.locator("#trendKpis .trend-kpi");
      await expect(cards).toHaveCount(6);
      const selectedNote = payload.notes.find(item => item.note_id === noteId);
      const singleReadCard = cards.filter({ hasText: "总阅读UV" });
      await expect(singleReadCard).toHaveCount(1);
      await expect(singleReadCard.locator(".trend-kpi-val")).toContainText(selectedNote.read_uv_funnel.toLocaleString("zh-CN"));
      await expect(page.locator("#trendKpis .trend-kpi-average")).toHaveCount(3);
      const averageParents = await page.locator("#trendKpis .trend-kpi-average").evaluateAll(items =>
        items.map(item => item.parentElement.className)
      );
      expect(averageParents).toEqual(["trend-kpi-val", "trend-kpi-val", "trend-kpi-val"]);

      const comparison = await page.locator("#trendKpis .trend-kpi-rate").evaluateAll(items =>
        items.map(item => ({ text: item.textContent.trim(), className: item.className }))
      );
      expect(comparison).toHaveLength(3);
      for (const item of comparison) {
        expect(item.text).toMatch(/^\d+\.\d{2}%$/);
        expect(item.className).toMatch(/is-(good|bad|neutral)/);
      }

      const averages = await page.locator("#trendKpis .trend-kpi-average").allTextContents();
      for (let index = 0; index < rateSpecs.length; index += 1) {
        const spec = rateSpecs[index];
        const note = selectedNote;
        const mean = arithmeticMean(spec.key);
        const current = note[spec.numerator] / note[spec.denominator];
        expect(note[spec.key]).toBeCloseTo(current, 12);
        expect(averages[index].trim()).toBe(`平均 ${(mean * 100).toFixed(2)}%`);
        expect(comparison[index].text).toBe(`${(current * 100).toFixed(2)}%`);
        expect(comparison[index].className).toContain(expectedClass(current, mean));
      }

      const hasOverflow = await page.locator("#trendKpis .trend-kpi").evaluateAll(items =>
        items.some(item => item.scrollWidth > item.clientWidth || item.scrollHeight > item.clientHeight)
      );
      expect(hasOverflow).toBe(false);
    });
  }
});

test("payload formulas and denominator exclusions", () => {
  for (const spec of rateSpecs) {
    const validNotes = payload.notes.filter(note => note[spec.denominator] > 0);
    const storedRates = payload.notes.filter(note => Number.isFinite(note[spec.key]));
    expect(storedRates).toHaveLength(validNotes.length);

    for (const note of validNotes) {
      expect(note[spec.key]).toBeCloseTo(note[spec.numerator] / note[spec.denominator], 12);
    }
    for (const note of payload.notes.filter(note => !(note[spec.denominator] > 0))) {
      expect(note[spec.key]).toBeNull();
    }

    const mean = arithmeticMean(spec.key);
    expect(storedRates.some(note => note[spec.key] > mean)).toBe(true);
    expect(storedRates.some(note => note[spec.key] < mean)).toBe(true);
  }
});
