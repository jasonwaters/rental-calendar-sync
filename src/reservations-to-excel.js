#!/usr/bin/env node

/**
 * TrackHS Reservations to Excel Converter
 *
 * Produces a multi-sheet Excel workbook:
 *   Sheet 1 - Monthly Summary: aggregated totals per month
 *   Sheet 2 - Reservations: all reservations sorted by check-in date
 */

const fs = require("fs").promises;
const path = require("path");
const dayjs = require("dayjs");
const XLSX = require("xlsx");
const {
  getOccupantCount,
  getTotalOccupants,
} = require("./reservations-to-csv");

const USD_FORMAT = '"$"#,##0.00';
const DATE_FORMAT = "mmm d, yyyy h:mm AM/PM";
const EXCEL_EPOCH_DIFF = 25569;
const MS_PER_DAY = 86400000;

function toExcelDate(dateString) {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  const tzOffsetMs = date.getTimezoneOffset() * 60 * 1000;
  const localMs = date.getTime() - tzOffsetMs;
  return localMs / MS_PER_DAY + EXCEL_EPOCH_DIFF;
}

function formatMonthLabel(yearMonth) {
  return dayjs(yearMonth + "-01").format("MMMM YYYY");
}

function applyCellFormat(ws, row, col, format) {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  if (ws[addr] && ws[addr].t === "n") {
    ws[addr].z = format;
  }
}

function setCell(ws, row, col, value, type, format) {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  ws[addr] = { t: type, v: value };
  if (format) ws[addr].z = format;
}

function setFormulaCell(ws, row, col, formula, cachedValue, format) {
  const addr = XLSX.utils.encode_cell({ r: row, c: col });
  ws[addr] = { t: "n", v: cachedValue ?? 0, f: formula };
  if (format) ws[addr].z = format;
}

function expandSheetRange(ws, maxRow, maxCol) {
  const range = XLSX.utils.decode_range(ws["!ref"]);
  if (maxRow > range.e.r) range.e.r = maxRow;
  if (maxCol > range.e.c) range.e.c = maxCol;
  ws["!ref"] = XLSX.utils.encode_range(range);
}

function aggregateByMonth(reservations) {
  const byMonth = {};

  reservations.forEach((res) => {
    const month = res.arrivalDate?.substring(0, 7) || "unknown";
    if (!byMonth[month]) {
      byMonth[month] = {
        count: 0,
        nights: 0,
        gross: 0,
        net: 0,
        mgmt: 0,
        occupants: 0,
      };
    }
    const d = byMonth[month];
    d.count += 1;
    d.nights += res.nights || 0;
    d.gross += parseFloat(res.ownerBreakdown?.grossRevenue || 0);
    d.net += parseFloat(res.ownerBreakdown?.netRevenue || 0);
    d.mgmt += parseFloat(res.ownerBreakdown?.managerCommission || 0);
    d.occupants += getTotalOccupants(res.occupants);
  });

  return byMonth;
}

function buildMonthlySummarySheet(reservations) {
  const byMonth = aggregateByMonth(reservations);
  const sortedMonths = Object.keys(byMonth)
    .filter((m) => m !== "unknown")
    .sort();

  const headers = [
    "Month",
    "Reservations",
    "Total Nights",
    "Gross Income",
    "Net Income",
    "Management Fees",
    "Avg Nightly Rate",
    "Avg Guests/Reservation",
  ];

  const rows = sortedMonths.map((month) => {
    const d = byMonth[month];
    const avgRate = d.nights > 0 ? d.gross / d.nights : 0;
    const avgGuests = d.count > 0 ? d.occupants / d.count : 0;
    return [
      formatMonthLabel(month),
      d.count,
      d.nights,
      d.gross,
      d.net,
      d.mgmt,
      avgRate,
      avgGuests,
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  for (let r = 1; r <= rows.length; r++) {
    for (const c of [3, 4, 5, 6]) applyCellFormat(ws, r, c, USD_FORMAT);
    applyCellFormat(ws, r, 7, "#,##0.0");
  }

  const totalsRowIdx = rows.length + 1;
  const excelFirstData = 2;
  const excelLastData = rows.length + 1;
  const excelTotalsRow = totalsRowIdx + 1;

  const totalReservations = sortedMonths.reduce(
    (sum, m) => sum + byMonth[m].count,
    0,
  );
  const totalNights = sortedMonths.reduce(
    (sum, m) => sum + byMonth[m].nights,
    0,
  );
  const totalGross = sortedMonths.reduce(
    (sum, m) => sum + byMonth[m].gross,
    0,
  );
  const totalNet = sortedMonths.reduce((sum, m) => sum + byMonth[m].net, 0);
  const totalMgmt = sortedMonths.reduce((sum, m) => sum + byMonth[m].mgmt, 0);
  const totalOccupants = sortedMonths.reduce(
    (sum, m) => sum + byMonth[m].occupants,
    0,
  );
  const overallAvgRate = totalNights > 0 ? totalGross / totalNights : 0;
  const overallAvgGuests =
    totalReservations > 0 ? totalOccupants / totalReservations : 0;

  setCell(ws, totalsRowIdx, 0, "Totals", "s");
  setFormulaCell(
    ws,
    totalsRowIdx,
    1,
    `SUM(B${excelFirstData}:B${excelLastData})`,
    totalReservations,
  );
  setFormulaCell(
    ws,
    totalsRowIdx,
    2,
    `SUM(C${excelFirstData}:C${excelLastData})`,
    totalNights,
  );
  setFormulaCell(
    ws,
    totalsRowIdx,
    3,
    `SUM(D${excelFirstData}:D${excelLastData})`,
    totalGross,
    USD_FORMAT,
  );
  setFormulaCell(
    ws,
    totalsRowIdx,
    4,
    `SUM(E${excelFirstData}:E${excelLastData})`,
    totalNet,
    USD_FORMAT,
  );
  setFormulaCell(
    ws,
    totalsRowIdx,
    5,
    `SUM(F${excelFirstData}:F${excelLastData})`,
    totalMgmt,
    USD_FORMAT,
  );
  setFormulaCell(
    ws,
    totalsRowIdx,
    6,
    `IF(C${excelTotalsRow}=0,0,D${excelTotalsRow}/C${excelTotalsRow})`,
    overallAvgRate,
    USD_FORMAT,
  );
  setCell(ws, totalsRowIdx, 7, overallAvgGuests, "n", "#,##0.0");

  expandSheetRange(ws, totalsRowIdx, headers.length - 1);

  ws["!cols"] = [
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 24 },
  ];

  return ws;
}

function buildReservationsSheet(reservations) {
  const sorted = [...reservations].sort((a, b) => {
    const dateA = a.arrivalTime || a.arrivalDate || "";
    const dateB = b.arrivalTime || b.arrivalDate || "";
    return dateA.localeCompare(dateB);
  });

  const headers = [
    "Reservation ID",
    "Status",
    "Booking Source",
    "Guest",
    "Check-In",
    "Check-Out",
    "Nights",
    "Total Occupants",
    "Adults",
    "Children",
    "Nightly Rate",
    "Gross Income",
    "Net Income",
    "Management Fees",
  ];

  const rows = sorted.map((res) => {
    const gross = parseFloat(res.ownerBreakdown?.grossRevenue || 0);
    const nights = res.nights || 0;
    const nightlyRate = nights > 0 ? gross / nights : 0;

    return [
      res.id || "",
      res.status || "",
      res.type?.name || "",
      res.contact?.name || "",
      toExcelDate(res.arrivalTime) ?? "",
      toExcelDate(res.departureTime) ?? "",
      nights,
      getTotalOccupants(res.occupants),
      getOccupantCount(res.occupants, "adults"),
      getOccupantCount(res.occupants, "children"),
      nightlyRate,
      gross,
      parseFloat(res.ownerBreakdown?.netRevenue || 0),
      parseFloat(res.ownerBreakdown?.managerCommission || 0),
    ];
  });

  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);

  for (let r = 1; r <= rows.length; r++) {
    for (const c of [4, 5]) applyCellFormat(ws, r, c, DATE_FORMAT);
    for (const c of [10, 11, 12, 13]) applyCellFormat(ws, r, c, USD_FORMAT);
  }

  ws["!cols"] = [
    { wch: 16 },
    { wch: 14 },
    { wch: 18 },
    { wch: 24 },
    { wch: 24 },
    { wch: 24 },
    { wch: 10 },
    { wch: 16 },
    { wch: 10 },
    { wch: 10 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
  ];

  return ws;
}

async function exportToExcel(reservations, outputPath) {
  const wb = XLSX.utils.book_new();

  const summarySheet = buildMonthlySummarySheet(reservations);
  XLSX.utils.book_append_sheet(wb, summarySheet, "Monthly Summary");

  const reservationsSheet = buildReservationsSheet(reservations);
  XLSX.utils.book_append_sheet(wb, reservationsSheet, "Reservations");

  XLSX.writeFile(wb, outputPath);
  console.log(`✓ Excel exported to: ${outputPath}`);
  return outputPath;
}

async function findMostRecentReservationsFile() {
  const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");

  try {
    const files = await fs.readdir(outputDir);
    const reservationFiles = files.filter(
      (f) => f.startsWith("reservations-") && f.endsWith(".json"),
    );

    if (reservationFiles.length === 0) return null;

    const filesWithStats = await Promise.all(
      reservationFiles.map(async (file) => {
        const filePath = path.join(outputDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      }),
    );

    filesWithStats.sort((a, b) => b.mtime - a.mtime);
    return filesWithStats[0].file;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
TrackHS Reservations to Excel Converter

Usage:
  node src/reservations-to-excel.js [input-file.json] [options]
  npm run excel [-- input-file.json] [-- options]

Arguments:
  input-file.json            Input JSON file (default: most recent reservations-*.json)

Options:
  --output FILE              Output Excel filename (default: same as input with .xlsx extension)
  --help, -h                 Show this help message

Examples:
  # Convert most recent reservations file
  npm run excel

  # Convert specific file
  npm run excel -- reservations-2026.json

  # Specify output filename
  npm run excel -- reservations-2026.json --output my-report.xlsx
`);
    process.exit(0);
  }

  try {
    const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");
    await fs.mkdir(outputDir, { recursive: true });

    let inputFileName = args[0];
    if (!inputFileName || inputFileName.startsWith("--")) {
      inputFileName = await findMostRecentReservationsFile();
      if (!inputFileName) {
        console.error(
          "ERROR: No reservations-*.json files found in output directory",
        );
        console.error("Run with --help for more information");
        process.exit(1);
      }
      console.log(`Using most recent file: ${inputFileName}`);
    }

    const inputFile = path.join(outputDir, path.basename(inputFileName));

    const outputFileIndex = args.indexOf("--output");
    let outputFile;
    if (outputFileIndex !== -1 && args[outputFileIndex + 1]) {
      outputFile = path.join(
        outputDir,
        path.basename(args[outputFileIndex + 1]),
      );
    } else {
      outputFile = inputFile.replace(".json", ".xlsx");
    }

    console.log(`Reading reservations from: ${inputFile}`);
    const jsonData = await fs.readFile(inputFile, "utf8");
    const reservations = JSON.parse(jsonData);

    if (!Array.isArray(reservations)) {
      console.error(
        "ERROR: Input file does not contain a valid reservations array",
      );
      process.exit(1);
    }

    console.log(`Found ${reservations.length} reservations`);
    await exportToExcel(reservations, outputFile);
    console.log("\n✓ Done!");
  } catch (error) {
    if (error.code === "ENOENT") {
      console.error("\n✗ Error: Input file not found");
    } else {
      console.error("\n✗ Error:", error.message);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { exportToExcel };
