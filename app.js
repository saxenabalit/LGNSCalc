/*
 * LGNS Dynamic Compound Investment Calculator - Web/PWA version.
 *
 * Mirrors the exact compounding logic and defaults used in
 * LGNSCalculator-flexible.py / LGNSCalculator-gui.py, so all three
 * (CLI, desktop GUI, mobile web app) produce identical results.
 */

const DEFAULTS = {
  quantity: 1000.0,
  price: 1.0,
  ratePercent: 0.14,
  duration: 12,
  usdInrRate: 100.0,
  salesTaxPercent: 40.0,
  withdrawPercent: 50.0,
  withdrawStartPeriod: 1,
};

const Calc = window.LGNSCalc;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayFirstOfMonthISO() {
  const today = new Date();
  return `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-01`;
}

function parseInvestmentDate(isoValue) {
  if (!isoValue) {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() + 1, day: 1 };
  }
  const [year, month, day] = isoValue.split("-").map(Number);
  return { year, month, day };
}

function fmt(value, decimals = 2) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function cleanNumberInput(el) {
  const raw = el.value.trim();
  return raw === "" ? null : Number(raw);
}

// ------------------------------------------------------------------
// DOM references
// ------------------------------------------------------------------
const form = document.getElementById("calc-form");
const resetBtn = document.getElementById("resetBtn");
const exportBtn = document.getElementById("exportBtn");
const errorBox = document.getElementById("error-box");
const reportCard = document.getElementById("report-card");
const resultsBody = document.getElementById("results-body");

const CHART_SERIES = [
  { id: "chart-closing", col: 6, color: "#3b82f6", fillId: "chartFillClosing" },
  { id: "chart-usd", col: 10, color: "#22c55e", fillId: "chartFillUsd" },
  { id: "chart-withdraw-inr", col: 9, color: "#f59e0b", fillId: "chartFillWithdrawInr" },
  { id: "chart-closing-inr", col: 11, color: "#14b8a6", fillId: "chartFillClosingInr" },
];

let lastSummaryItems = [];
let lastExportRows = [];
let selectedDuration = DEFAULTS.duration;
let selectedTimeUnit = "M";

function showError(message) {
  errorBox.textContent = `\u274c ${message}`;
  errorBox.hidden = false;
  reportCard.hidden = true;
}

function clearError() {
  errorBox.hidden = true;
  errorBox.textContent = "";
}

function applyDefaults() {
  document.getElementById("investmentDate").value = todayFirstOfMonthISO();
  document.getElementById("quantity").value = DEFAULTS.quantity;
  document.getElementById("price").value = DEFAULTS.price;
  document.getElementById("rate").value = DEFAULTS.ratePercent;
  document.getElementById("usdInr").value = DEFAULTS.usdInrRate;
  document.getElementById("salesTax").value = DEFAULTS.salesTaxPercent;
  document.getElementById("withdrawPercent").value = DEFAULTS.withdrawPercent;
  document.getElementById("withdrawStart").value = DEFAULTS.withdrawStartPeriod;
  selectedDuration = DEFAULTS.duration;
  selectedTimeUnit = "M";
  setActiveQuickSelect(selectedDuration, selectedTimeUnit);
}

// ------------------------------------------------------------------
// Duration Quick Select (6M / 12M / 24M / 3Y / 5Y)
// ------------------------------------------------------------------
const quickButtons = Array.from(document.querySelectorAll(".quick-btn"));

function setActiveQuickSelect(duration, unit) {
  selectedDuration = duration;
  selectedTimeUnit = unit;
  quickButtons.forEach((btn) => {
    const matches = Number(btn.dataset.duration) === duration && btn.dataset.unit === unit;
    btn.classList.toggle("active", matches);
  });
}

quickButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    setActiveQuickSelect(Number(btn.dataset.duration), btn.dataset.unit);
    form.requestSubmit();
  });
});

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderSummaryCards(rows, principal, tokenPrice, usdInrRate) {
  const lastRow = rows[rows.length - 1];
  const [, , , , , , tokenClosing, , , cumulativeWithdrawalInr, endingUsdValue, endingInrValue] = lastRow;

  setText("cardFinalBalance", fmt(tokenClosing));
  setText("cardFinalUsd", `$${fmt(endingUsdValue)}`);
  setText("cardFinalUsdSub", `(at $${fmt(tokenPrice, 4)})`);
  setText("cardFinalInr", `\u20b9${fmt(endingInrValue)}`);
  setText("cardFinalInrSub", `(at \u20b9${fmt(usdInrRate)})`);

  const multiplier = principal > 0 ? tokenClosing / principal : 0;
  setText("cardGrowth", `${fmt(multiplier)}x`);
  setText("cardGrowthSub", `(vs. initial ${fmt(principal, 0)} tokens)`);
  setText("cardWithdrawn", `\u20b9${fmt(cumulativeWithdrawalInr)}`);
}

function renderTable(rows) {
  if (!resultsBody) return;
  resultsBody.innerHTML = "";
  const finalPeriod = rows.length;
  for (const row of rows) {
    const tr = document.createElement("tr");
    const [
      periodIndex, label, cycles, endingBalance, tokensAdded, tokensWithdrawn,
      tokenClosing, withdrawalUsd, withdrawalInr, cumulativeWithdrawalInr,
      endingUsdValue, endingInrValue,
    ] = row;

    if (periodIndex === finalPeriod) tr.classList.add("row-final");

    const cells = [
      periodIndex,
      label,
      cycles,
      fmt(endingBalance),
      fmt(tokensAdded),
      fmt(tokensWithdrawn),
      fmt(tokenClosing),
      `$${fmt(withdrawalUsd)}`,
      `\u20b9${fmt(withdrawalInr)}`,
      `\u20b9${fmt(cumulativeWithdrawalInr)}`,
      `$${fmt(endingUsdValue)}`,
      `\u20b9${fmt(endingInrValue)}`,
    ];

    for (const cellValue of cells) {
      const td = document.createElement("td");
      td.textContent = cellValue;
      tr.appendChild(td);
    }
    resultsBody.appendChild(tr);
  }
}

// ------------------------------------------------------------------
// Chart: lightweight dependency-free SVG line chart
// ------------------------------------------------------------------
function niceMax(value) {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  let niceNormalized;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 2.5) niceNormalized = 2.5;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

function renderChart(rows, series) {
  const chartContainer = document.getElementById(series.id);
  if (!chartContainer) return;
  chartContainer.innerHTML = "";

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "chart-empty";
    empty.textContent = "Calculate a report to see the growth chart.";
    chartContainer.appendChild(empty);
    return;
  }

  const values = rows.map((row) => row[series.col]);
  const labels = rows.map((row) => row[1]);

  const width = Math.max(chartContainer.clientWidth || 280, 220);
  const height = 200;
  const padding = { top: 22, right: 12, bottom: 32, left: 52 };
  const plotW = width - padding.left - padding.right;
  const plotH = height - padding.top - padding.bottom;

  const maxVal = niceMax(Math.max(...values, 0));
  const minVal = 0;
  const n = values.length;

  const xFor = (i) => padding.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
  const yFor = (v) => padding.top + plotH - ((v - minVal) / (maxVal - minVal || 1)) * plotH;

  const lineColor = series.color;
  const fillId = series.fillId;

  const linePoints = values.map((v, i) => `${xFor(i)},${yFor(v)}`).join(" ");
  const areaPoints = `${xFor(0)},${yFor(minVal)} ${linePoints} ${xFor(n - 1)},${yFor(minVal)}`;

  const gridSteps = 4;
  let gridLines = "";
  let gridLabels = "";
  for (let i = 0; i <= gridSteps; i++) {
    const val = (maxVal / gridSteps) * i;
    const y = yFor(val);
    gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(15,23,42,0.08)" stroke-width="1" />`;
    gridLabels += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" font-size="9.5" fill="#64748b">${fmt(val, 0)}</text>`;
  }

  const maxTicks = Math.min(5, n);
  let xLabels = "";
  for (let t = 0; t < maxTicks; t++) {
    const i = maxTicks === 1 ? 0 : Math.round((t / (maxTicks - 1)) * (n - 1));
    xLabels += `<text x="${xFor(i)}" y="${height - padding.bottom + 18}" text-anchor="middle" font-size="9" fill="#64748b">${labels[i]}</text>`;
  }

  let dots = "";
  const dotStep = n > 24 ? Math.ceil(n / 24) : 1;
  for (let i = 0; i < n; i += dotStep) {
    dots += `<circle cx="${xFor(i)}" cy="${yFor(values[i])}" r="2.5" fill="${lineColor}" stroke="#ffffff" stroke-width="1.5"><title>${labels[i]}: ${fmt(values[i])}</title></circle>`;
  }
  const lastI = n - 1;
  dots += `<circle cx="${xFor(lastI)}" cy="${yFor(values[lastI])}" r="4" fill="${lineColor}" stroke="#ffffff" stroke-width="2" />`;

  const lastLabel = `<text x="${xFor(lastI)}" y="${yFor(values[lastI]) - 10}" text-anchor="end" font-size="11" font-weight="700" fill="${lineColor}">${fmt(values[lastI])}</text>`;

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="${fillId}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="${lineColor}" stop-opacity="0.35" />
          <stop offset="100%" stop-color="${lineColor}" stop-opacity="0" />
        </linearGradient>
      </defs>
      ${gridLines}
      ${gridLabels}
      <polygon points="${areaPoints}" fill="url(#${fillId})" />
      <polyline points="${linePoints}" fill="none" stroke="${lineColor}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
      ${lastLabel}
      ${xLabels}
    </svg>
  `;

  chartContainer.innerHTML = svg;
}

function renderAllCharts(rows) {
  CHART_SERIES.forEach((series) => renderChart(rows, series));
}

// ------------------------------------------------------------------
// Main calculation handler
// ------------------------------------------------------------------
form.addEventListener("submit", (event) => {
  event.preventDefault();
  clearError();

  try {
    const investmentDate = parseInvestmentDate(
      document.getElementById("investmentDate").value
    );

    const principal = cleanNumberInput(document.getElementById("quantity")) ?? DEFAULTS.quantity;
    const tokenPrice = cleanNumberInput(document.getElementById("price")) ?? DEFAULTS.price;
    const cycleRatePercent = cleanNumberInput(document.getElementById("rate")) ?? DEFAULTS.ratePercent;
    const usdInrRate = cleanNumberInput(document.getElementById("usdInr")) ?? DEFAULTS.usdInrRate;
    const salesTaxPercent = cleanNumberInput(document.getElementById("salesTax")) ?? DEFAULTS.salesTaxPercent;
    const withdrawPercent = cleanNumberInput(document.getElementById("withdrawPercent")) ?? DEFAULTS.withdrawPercent;
    const withdrawStartPeriod = cleanNumberInput(document.getElementById("withdrawStart")) ?? DEFAULTS.withdrawStartPeriod;
    const duration = selectedDuration;
    const timeUnit = selectedTimeUnit;

    if (principal < 0) throw new Error("LGNS token quantity cannot be negative.");
    if (tokenPrice < 0) throw new Error("LGNS token price cannot be negative.");
    if (cycleRatePercent < 0) throw new Error("Interest rate cannot be negative.");
    if (duration <= 0) throw new Error("Duration must be greater than zero.");
    if (usdInrRate < 0) throw new Error("USD to INR rate cannot be negative.");
    if (salesTaxPercent < 0 || salesTaxPercent > 100) throw new Error("Sales tax must be between 0 and 100.");
    if (withdrawPercent < 0 || withdrawPercent > 100) throw new Error("Withdrawal percentage must be between 0 and 100.");
    if (withdrawStartPeriod < 1) throw new Error("Withdrawal starting period must be 1 or greater.");

    const isYears = timeUnit === "Y";

    const investmentDateLabel = Calc.formatDateLabel(investmentDate);
    const periodCycles = isYears ? 1460 : 120;

    const summaryItems = [
      ["Investment Date", investmentDateLabel],
      ["Starting Tokens", fmt(principal, 4)],
      ["Token Price", `$${fmt(tokenPrice, 4)}`],
      ["Rate Per Cycle", `${cycleRatePercent}%`],
      ["USD to INR Rate", `\u20b9${fmt(usdInrRate)}`],
      ["Sales Tax", `${salesTaxPercent}%`],
      ["Withdraw %", `${withdrawPercent}%`],
      ["Withdraw From", `Period ${withdrawStartPeriod}`],
      ["Compounding Cycles/Day", "4"],
      ["Cycles per Period", `${periodCycles}`],
      ["Calculation", isYears ? "Years" : "Months"],
      ["Duration", `${duration} ${isYears ? "Year(s)" : "Month(s)"}`],
    ];

    const exportRows = Calc.runCompounding({
      investmentDate,
      duration: Math.trunc(duration),
      isYears,
      principal,
      tokenPrice,
      cycleRatePercent,
      usdInrRate,
      salesTaxPercent,
      withdrawPercent,
      withdrawStartPeriod,
    });

    lastSummaryItems = summaryItems;
    lastExportRows = exportRows;

    renderSummaryCards(exportRows, principal, tokenPrice, usdInrRate);
    renderTable(exportRows);
    renderAllCharts(exportRows);

    reportCard.hidden = false;
    reportCard.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(error.message || String(error));
  }
});

resetBtn.addEventListener("click", () => {
  applyDefaults();
  clearError();
});

window.addEventListener("resize", () => {
  if (lastExportRows.length) renderAllCharts(lastExportRows);
});

// ------------------------------------------------------------------
// Excel export (client-side, via SheetJS - no server needed)
// ------------------------------------------------------------------
exportBtn.addEventListener("click", () => {
  if (!lastExportRows.length) return;

  const tableHeaders = [
    "Period #", "Date", "Total Cycles", "Token Balance", "Tokens Added",
    "Tokens Withdrawn", "Token Closing", "Withdraw USD", "Withdraw INR",
    "Withdraw INR (Cum.)", "Closing USD", "Closing INR",
  ];

  function setCell(ws, row1, col1, value, numFmt) {
    const ref = XLSX.utils.encode_cell({ r: row1 - 1, c: col1 - 1 });
    const cell = { v: value };
    if (typeof value === "number") {
      cell.t = "n";
      if (numFmt) cell.z = numFmt;
    } else {
      cell.t = "s";
    }
    ws[ref] = cell;
  }

  const ws = {};
  setCell(ws, 1, 1, "LGNS Dynamic Compound Investment Report");
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 3 } }];

  let currentRow = 3;
  for (let rowStart = 0; rowStart < lastSummaryItems.length; rowStart += 4) {
    const rowItems = lastSummaryItems.slice(rowStart, rowStart + 4);
    let col = 1;
    for (const [label, value] of rowItems) {
      setCell(ws, currentRow, col, `${label}:`);
      setCell(ws, currentRow, col + 1, value);
      col += 2;
    }
    currentRow += 1;
  }

  currentRow += 1;

  tableHeaders.forEach((heading, idx) => setCell(ws, currentRow, idx + 1, heading));
  const tableStartRow = currentRow + 1;

  lastExportRows.forEach((rowValues, offset) => {
    rowValues.forEach((value, idx) => {
      const numFmt = idx >= 3 ? "#,##0.00" : undefined;
      setCell(ws, tableStartRow + offset, idx + 1, value, numFmt);
    });
  });

  const maxRow = tableStartRow + lastExportRows.length - 1;
  ws["!ref"] = XLSX.utils.encode_range({
    s: { r: 0, c: 0 },
    e: { r: maxRow - 1, c: tableHeaders.length - 1 },
  });
  ws["!cols"] = new Array(tableHeaders.length).fill({ wch: 18 });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "LGNS Report");

  const timestamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 15);
  XLSX.writeFile(wb, `LGNS_Report_${timestamp}.xlsx`);
});

// ------------------------------------------------------------------
// Init
// ------------------------------------------------------------------
applyDefaults();

const APP_VERSION = "7";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      if (localStorage.getItem("lgns-app-version") !== APP_VERSION) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((key) => caches.delete(key)));
        }
        localStorage.setItem("lgns-app-version", APP_VERSION);
        window.location.reload();
        return;
      }

      navigator.serviceWorker
        .register("service-worker.js", { updateViaCache: "none" })
        .then((registration) => registration.update());
    } catch (error) {
      /* offline support is a nice-to-have; ignore registration failures */
    }
  });
}
