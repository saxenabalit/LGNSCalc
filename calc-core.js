/*
 * Pure compounding logic shared by the web app and by automated tests.
 * No DOM dependency here, so it can run identically in the browser
 * and under plain Node.js.
 *
 * Mirrors LGNSCalculator-flexible.py / LGNSCalculator-gui.py exactly.
 */

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function pad2(n) {
  return String(n).padStart(2, "0");
}

function daysInMonth(year, oneBasedMonth) {
  // Day 0 of "next" month == last day of the target month.
  return new Date(year, oneBasedMonth, 0).getDate();
}

function formatDateLabel(dateParts) {
  return `${pad2(dateParts.day)}-${MONTH_ABBR[dateParts.month - 1]}-${dateParts.year}`;
}

function calculateMilestones(investmentDate, duration, isYears) {
  const milestones = [];

  if (isYears) {
    // 1 year = 365 days, 4 cycles/day -> 1460 cycles/year
    for (let i = 1; i <= duration; i++) {
      const targetYear = investmentDate.year + i;
      const targetMonth = investmentDate.month;
      const lastDay = daysInMonth(targetYear, targetMonth);
      const targetDay = Math.min(investmentDate.day, lastDay);
      milestones.push({
        date: { year: targetYear, month: targetMonth, day: targetDay },
        cycles: i * 1460,
      });
    }
  } else {
    // 1 month = 30 days, 4 cycles/day -> 120 cycles/month
    for (let i = 1; i <= duration; i++) {
      const totalMonths = investmentDate.year * 12 + (investmentDate.month - 1) + i;
      const targetYear = Math.floor(totalMonths / 12);
      const targetMonth = (totalMonths % 12) + 1;
      const lastDay = daysInMonth(targetYear, targetMonth);
      const targetDay = Math.min(investmentDate.day, lastDay);
      milestones.push({
        date: { year: targetYear, month: targetMonth, day: targetDay },
        cycles: i * 120,
      });
    }
  }

  return milestones;
}

/**
 * Runs the full iterative compounding calculation.
 *
 * @returns {Array<Array<number|string>>} rows of
 *   [periodIndex, dateLabel, cycles, endingBalance, tokensAdded,
 *    tokensWithdrawn, tokenClosing, withdrawalUsd, withdrawalInr,
 *    cumulativeWithdrawalInr, endingUsdValue, endingInrValue]
 */
function runCompounding({
  investmentDate, duration, isYears, principal, tokenPrice,
  cycleRatePercent, usdInrRate, salesTaxPercent, withdrawPercent,
  withdrawStartPeriod,
}) {
  const rateDecimal = cycleRatePercent / 100;
  const salesTaxDecimal = salesTaxPercent / 100;
  const withdrawPercentDecimal = withdrawPercent / 100;
  const periodCycles = isYears ? 1460 : 120;

  const milestones = calculateMilestones(investmentDate, duration, isYears);

  let openingBalance = principal;
  let cumulativeWithdrawalInr = 0.0;
  const rows = [];

  milestones.forEach((milestone, idx) => {
    const periodIndex = idx + 1;
    const label = formatDateLabel(milestone.date);
    const cycles = milestone.cycles;

    const endingBalance = openingBalance * Math.pow(1 + rateDecimal, periodCycles);
    const tokensAdded = endingBalance - openingBalance;
    const tokensWithdrawn = periodIndex >= withdrawStartPeriod
      ? tokensAdded * withdrawPercentDecimal
      : 0.0;
    const tokenClosing = endingBalance - tokensWithdrawn;
    openingBalance = tokenClosing;

    const effectiveWithdrawalRate = tokenPrice * (1 - salesTaxDecimal);
    const withdrawalUsdValue = tokensWithdrawn * effectiveWithdrawalRate;
    const withdrawalInrValue = withdrawalUsdValue * usdInrRate;
    cumulativeWithdrawalInr += withdrawalInrValue;

    const endingUsdValue = tokenClosing * tokenPrice;
    const endingInrValue = endingUsdValue * usdInrRate;

    rows.push([
      periodIndex, label, cycles, endingBalance, tokensAdded, tokensWithdrawn,
      tokenClosing, withdrawalUsdValue, withdrawalInrValue, cumulativeWithdrawalInr,
      endingUsdValue, endingInrValue,
    ]);
  });

  return rows;
}

const LGNSCalc = { daysInMonth, formatDateLabel, calculateMilestones, runCompounding };

if (typeof module !== "undefined" && module.exports) {
  module.exports = LGNSCalc;
}
if (typeof window !== "undefined") {
  window.LGNSCalc = LGNSCalc;
}
