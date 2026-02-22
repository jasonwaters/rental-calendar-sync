#!/usr/bin/env node

/**
 * TrackHS Reservations to Markdown Report
 *
 * Produces a markdown file with:
 *   - Monthly Summary table with totals
 *   - Reservations detail table sorted by check-in date
 */

const fs = require("fs").promises;
const path = require("path");
const dayjs = require("dayjs");
const {
  getOccupantCount,
  getTotalOccupants,
} = require("./reservations-to-csv");

function formatUsd(value) {
  return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(dateString) {
  if (!dateString) return "";
  return dayjs(dateString).format("MMM D, YYYY h:mm A");
}

function formatMonthLabel(yearMonth) {
  return dayjs(yearMonth + "-01").format("MMMM YYYY");
}

function padRight(str, len) {
  return String(str).padEnd(len);
}

function padLeft(str, len) {
  return String(str).padStart(len);
}

function buildMarkdownTable(headers, alignments, rows) {
  const colWidths = headers.map((h, i) => {
    const headerLen = h.length;
    const maxDataLen = rows.reduce(
      (max, row) => Math.max(max, String(row[i]).length),
      0,
    );
    return Math.max(headerLen, maxDataLen);
  });

  const pad = (val, colIdx) =>
    alignments[colIdx] === "right"
      ? padLeft(val, colWidths[colIdx])
      : padRight(val, colWidths[colIdx]);

  const headerLine = `| ${headers.map((h, i) => pad(h, i)).join(" | ")} |`;

  const separatorLine = `| ${colWidths
    .map((w, i) => {
      const dashes = "-".repeat(w);
      return alignments[i] === "right" ? dashes + ":" : dashes + " ";
    })
    .join("| ")}|`;

  const dataLines = rows.map(
    (row) => `| ${row.map((cell, i) => pad(cell, i)).join(" | ")} |`,
  );

  return [headerLine, separatorLine, ...dataLines].join("\n");
}

function aggregateByMonth(reservations) {
  const byMonth = {};

  for (const res of reservations) {
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
  }

  return byMonth;
}

function buildMonthlySummary(reservations) {
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
    "Avg Guests",
  ];

  const alignments = [
    "left",
    "right",
    "right",
    "right",
    "right",
    "right",
    "right",
    "right",
  ];

  const rows = sortedMonths.map((month) => {
    const d = byMonth[month];
    const avgRate = d.nights > 0 ? d.gross / d.nights : 0;
    const avgGuests = d.count > 0 ? d.occupants / d.count : 0;
    return [
      formatMonthLabel(month),
      String(d.count),
      String(d.nights),
      formatUsd(d.gross),
      formatUsd(d.net),
      formatUsd(d.mgmt),
      formatUsd(avgRate),
      avgGuests.toFixed(1),
    ];
  });

  const totalCount = sortedMonths.reduce(
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
  const overallAvgGuests = totalCount > 0 ? totalOccupants / totalCount : 0;

  rows.push([
    "**Totals**",
    `**${totalCount}**`,
    `**${totalNights}**`,
    `**${formatUsd(totalGross)}**`,
    `**${formatUsd(totalNet)}**`,
    `**${formatUsd(totalMgmt)}**`,
    `**${formatUsd(overallAvgRate)}**`,
    `**${overallAvgGuests.toFixed(1)}**`,
  ]);

  return buildMarkdownTable(headers, alignments, rows);
}

function buildReservationsTable(reservations) {
  const sorted = [...reservations].sort((a, b) => {
    const dateA = a.arrivalTime || a.arrivalDate || "";
    const dateB = b.arrivalTime || b.arrivalDate || "";
    return dateA.localeCompare(dateB);
  });

  const headers = [
    "ID",
    "Status",
    "Source",
    "Guest",
    "Check-In",
    "Check-Out",
    "Nights",
    "Guests",
    "Adults",
    "Children",
    "Nightly Rate",
    "Gross",
    "Net",
    "Mgmt Fees",
  ];

  const alignments = [
    "left",
    "left",
    "left",
    "left",
    "left",
    "left",
    "right",
    "right",
    "right",
    "right",
    "right",
    "right",
    "right",
    "right",
  ];

  const rows = sorted.map((res) => {
    const gross = parseFloat(res.ownerBreakdown?.grossRevenue || 0);
    const nights = res.nights || 0;
    const nightlyRate = nights > 0 ? gross / nights : 0;

    return [
      String(res.id || ""),
      res.status || "",
      res.type?.name || "",
      res.contact?.name || "",
      formatDate(res.arrivalTime),
      formatDate(res.departureTime),
      String(nights),
      String(getTotalOccupants(res.occupants)),
      String(getOccupantCount(res.occupants, "adults")),
      String(getOccupantCount(res.occupants, "children")),
      formatUsd(nightlyRate),
      formatUsd(gross),
      formatUsd(parseFloat(res.ownerBreakdown?.netRevenue || 0)),
      formatUsd(parseFloat(res.ownerBreakdown?.managerCommission || 0)),
    ];
  });

  return buildMarkdownTable(headers, alignments, rows);
}

async function exportToMarkdown(reservations, outputPath) {
  const generatedAt = dayjs().format("MMMM D, YYYY h:mm A");

  const lines = [
    "# Reservations Report",
    "",
    `> Generated ${generatedAt}  `,
    `> ${reservations.length} reservations`,
    "",
    "## Monthly Summary",
    "",
    buildMonthlySummary(reservations),
    "",
    "## Reservations",
    "",
    buildReservationsTable(reservations),
    "",
  ];

  await fs.writeFile(outputPath, lines.join("\n"), "utf8");
  console.log(`✓ Markdown exported to: ${outputPath}`);
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
TrackHS Reservations to Markdown Report

Usage:
  node src/reservations-to-markdown.js [input-file.json] [options]
  npm run markdown [-- input-file.json] [-- options]

Arguments:
  input-file.json            Input JSON file (default: most recent reservations-*.json)

Options:
  --output FILE              Output Markdown filename (default: same as input with .md extension)
  --help, -h                 Show this help message

Examples:
  # Convert most recent reservations file
  npm run markdown

  # Convert specific file
  npm run markdown -- reservations-2026.json

  # Specify output filename
  npm run markdown -- reservations-2026.json --output my-report.md
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
      outputFile = inputFile.replace(".json", ".md");
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
    await exportToMarkdown(reservations, outputFile);
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

module.exports = { exportToMarkdown };
