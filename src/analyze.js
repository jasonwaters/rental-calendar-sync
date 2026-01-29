#!/usr/bin/env node

/**
 * Analyze TrackHS Reservation Data
 *
 * Provides insights and statistics from exported reservation data
 */

const fs = require("fs");
const path = require("path");

function loadReservations(filename) {
  const filepath = path.resolve(filename);
  const data = fs.readFileSync(filepath, "utf8");
  return JSON.parse(data);
}

function analyzeReservations(reservations) {
  const analysis = {
    totalReservations: reservations.length,
    totalNights: 0,
    totalGrossRevenue: 0,
    totalNetRevenue: 0,
    totalManagementIncome: 0,
    averageNightlyRate: 0,
    totalOccupants: 0,
    totalAdults: 0,
    totalChildren: 0,
    byStatus: {},
    byBookingSource: {},
    byMonth: {},
    byUnit: {},
  };

  // Helper to get occupant count
  const getOccupantCount = (occupants, type) => {
    if (!occupants || !Array.isArray(occupants)) return 0;
    const occupant = occupants.find(
      (occ) => occ.handle === type || occ.name === type,
    );
    return occupant ? occupant.quantity || 0 : 0;
  };

  const getTotalOccupants = (occupants) => {
    if (!occupants || !Array.isArray(occupants)) return 0;
    return occupants.reduce((total, occ) => total + (occ.quantity || 0), 0);
  };

  reservations.forEach((res) => {
    // Total nights and revenue (using ownerBreakdown like CSV)
    const nights = res.nights || 0;
    const grossRevenue = parseFloat(res.ownerBreakdown?.grossRevenue || 0);
    const netRevenue = parseFloat(res.ownerBreakdown?.netRevenue || 0);
    const managementIncome = parseFloat(
      res.ownerBreakdown?.managerCommission || 0,
    );

    analysis.totalNights += nights;
    analysis.totalGrossRevenue += grossRevenue;
    analysis.totalNetRevenue += netRevenue;
    analysis.totalManagementIncome += managementIncome;

    // Occupancy
    analysis.totalOccupants += getTotalOccupants(res.occupants);
    analysis.totalAdults += getOccupantCount(res.occupants, "adults");
    analysis.totalChildren += getOccupantCount(res.occupants, "children");

    // By status
    const status = res.status || "unknown";
    if (!analysis.byStatus[status]) {
      analysis.byStatus[status] = {
        count: 0,
        nights: 0,
        grossRevenue: 0,
        netRevenue: 0,
      };
    }
    analysis.byStatus[status].count += 1;
    analysis.byStatus[status].nights += nights;
    analysis.byStatus[status].grossRevenue += grossRevenue;
    analysis.byStatus[status].netRevenue += netRevenue;

    // By booking source (using type.name like CSV)
    const source = res.type?.name || res.source || "unknown";
    if (!analysis.byBookingSource[source]) {
      analysis.byBookingSource[source] = {
        count: 0,
        nights: 0,
        grossRevenue: 0,
        netRevenue: 0,
      };
    }
    analysis.byBookingSource[source].count += 1;
    analysis.byBookingSource[source].nights += nights;
    analysis.byBookingSource[source].grossRevenue += grossRevenue;
    analysis.byBookingSource[source].netRevenue += netRevenue;

    // By month
    const month = res.arrivalDate?.substring(0, 7) || "unknown";
    if (!analysis.byMonth[month]) {
      analysis.byMonth[month] = {
        count: 0,
        nights: 0,
        grossRevenue: 0,
        netRevenue: 0,
        occupants: 0,
      };
    }
    analysis.byMonth[month].count += 1;
    analysis.byMonth[month].nights += nights;
    analysis.byMonth[month].grossRevenue += grossRevenue;
    analysis.byMonth[month].netRevenue += netRevenue;
    analysis.byMonth[month].occupants += getTotalOccupants(res.occupants);

    // By unit
    const unitName =
      res._embedded?.unit?.name || `Unit ${res.unitId}` || "unknown";
    if (!analysis.byUnit[unitName]) {
      analysis.byUnit[unitName] = {
        count: 0,
        nights: 0,
        grossRevenue: 0,
        netRevenue: 0,
      };
    }
    analysis.byUnit[unitName].count += 1;
    analysis.byUnit[unitName].nights += nights;
    analysis.byUnit[unitName].grossRevenue += grossRevenue;
    analysis.byUnit[unitName].netRevenue += netRevenue;
  });

  // Calculate average nightly rate
  if (analysis.totalNights > 0) {
    analysis.averageNightlyRate =
      analysis.totalGrossRevenue / analysis.totalNights;
  }

  return analysis;
}

function printAnalysis(analysis) {
  console.log(
    "\n═════════════════════════════════════════════════════════════════════════════════════════════════════",
  );
  console.log(
    "                                    TRACKHS RESERVATION ANALYSIS",
  );
  console.log(
    "═════════════════════════════════════════════════════════════════════════════════════════════════════\n",
  );

  // Overall statistics
  console.log("📊 OVERALL STATISTICS");
  console.log(
    "─────────────────────────────────────────────────────────────────────────────────────────────────────",
  );
  console.log(`Total Reservations:      ${analysis.totalReservations}`);
  console.log(`Total Nights:            ${analysis.totalNights}`);
  console.log(
    `Average Nightly Rate:    $${analysis.averageNightlyRate.toFixed(2)}`,
  );
  console.log("");
  console.log(
    `Gross Income:            $${analysis.totalGrossRevenue.toFixed(2)}`,
  );
  console.log(
    `Net Income:              $${analysis.totalNetRevenue.toFixed(2)}`,
  );
  console.log(
    `Management Income:       $${analysis.totalManagementIncome.toFixed(2)}`,
  );
  console.log("");
  console.log(`Total Occupants:         ${analysis.totalOccupants}`);
  console.log(`  Adults:                ${analysis.totalAdults}`);
  console.log(`  Children:              ${analysis.totalChildren}`);
  console.log("");

  // By status
  console.log("📋 BY STATUS");
  console.log(
    "─────────────────────────────────────────────────────────────────────────────────────────────────────",
  );
  console.log(
    "Status           Reservations    Nights    Gross Income      Net Income",
  );
  console.log(
    "─────────────────────────────────────────────────────────────────────────────────────────────────────",
  );
  Object.entries(analysis.byStatus)
    .sort((a, b) => b[1].grossRevenue - a[1].grossRevenue)
    .forEach(([status, data]) => {
      console.log(
        `${status.padEnd(16)} ${data.count.toString().padStart(12)} ` +
          `${data.nights.toString().padStart(9)} ` +
          `$${data.grossRevenue.toFixed(2).padStart(15)} ` +
          `$${data.netRevenue.toFixed(2).padStart(14)}`,
      );
    });
  console.log("");

  // By booking source
  console.log("🌐 BY BOOKING SOURCE");
  console.log(
    "─────────────────────────────────────────────────────────────────────────────────────────────────────",
  );
  console.log(
    "Source                   Reservations    Nights    Gross Income      Net Income    Nightly Rate",
  );
  console.log(
    "─────────────────────────────────────────────────────────────────────────────────────────────────────",
  );
  Object.entries(analysis.byBookingSource)
    .sort((a, b) => b[1].grossRevenue - a[1].grossRevenue)
    .forEach(([source, data]) => {
      const avgRate = data.nights > 0 ? data.grossRevenue / data.nights : 0;
      console.log(
        `${source.padEnd(24)} ${data.count.toString().padStart(12)} ` +
          `${data.nights.toString().padStart(9)} ` +
          `$${data.grossRevenue.toFixed(2).padStart(15)} ` +
          `$${data.netRevenue.toFixed(2).padStart(13)} ` +
          `$${avgRate.toFixed(2).padStart(14)}`,
      );
    });
  console.log("");

  // By month
  console.log("📅 BY MONTH");
  console.log(
    "─────────────────────────────────────────────────────────────────────────────────────────────────────",
  );
  console.log(
    "Month        Reservations    Nights    Occupants    Gross Income      Net Income    Nightly Rate",
  );
  console.log(
    "─────────────────────────────────────────────────────────────────────────────────────────────────────",
  );
  Object.entries(analysis.byMonth)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([month, data]) => {
      const avgRate = data.nights > 0 ? data.grossRevenue / data.nights : 0;
      console.log(
        `${month.padEnd(12)} ${data.count.toString().padStart(12)} ` +
          `${data.nights.toString().padStart(9)} ` +
          `${data.occupants.toString().padStart(12)} ` +
          `$${data.grossRevenue.toFixed(2).padStart(15)} ` +
          `$${data.netRevenue.toFixed(2).padStart(13)} ` +
          `$${avgRate.toFixed(2).padStart(14)}`,
      );
    });
  console.log("");

  // By unit
  if (Object.keys(analysis.byUnit).length > 0) {
    console.log("🏠 BY PROPERTY");
    console.log(
      "─────────────────────────────────────────────────────────────────────────────────────────────────────",
    );
    console.log(
      "Property                                   Reservations    Nights    Gross Income      Net Income",
    );
    console.log(
      "─────────────────────────────────────────────────────────────────────────────────────────────────────",
    );
    Object.entries(analysis.byUnit)
      .sort((a, b) => b[1].grossRevenue - a[1].grossRevenue)
      .forEach(([unitName, data]) => {
        const displayName =
          unitName.length > 42 ? unitName.substring(0, 39) + "..." : unitName;
        console.log(
          `${displayName.padEnd(42)} ${data.count.toString().padStart(12)} ` +
            `${data.nights.toString().padStart(9)} ` +
            `$${data.grossRevenue.toFixed(2).padStart(15)} ` +
            `$${data.netRevenue.toFixed(2).padStart(13)}`,
        );
      });
    console.log("");
  }

  console.log(
    "═════════════════════════════════════════════════════════════════════════════════════════════════════\n",
  );
}

function exportToCsv(reservations, outputFile) {
  const dayjs = require("dayjs");

  // Format date helper
  const formatDate = (dateString) => {
    if (!dateString) return "";
    try {
      return dayjs(dateString).format("dddd, MMMM DD, YYYY h:mm A");
    } catch (e) {
      return dateString;
    }
  };

  // Helper to get occupant count
  const getOccupantCount = (occupants, type) => {
    if (!occupants || !Array.isArray(occupants)) return 0;
    const occupant = occupants.find(
      (occ) => occ.handle === type || occ.name === type,
    );
    return occupant ? occupant.quantity || 0 : 0;
  };

  const getTotalOccupants = (occupants) => {
    if (!occupants || !Array.isArray(occupants)) return 0;
    return occupants.reduce((total, occ) => total + (occ.quantity || 0), 0);
  };

  // Define CSV headers (matching main script)
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
    "Management Income",
  ];

  // Calculate nightly rate
  const calculateNightlyRate = (grossRevenue, nights) => {
    if (!nights || nights === 0) return "0.00";
    const rate = parseFloat(grossRevenue || 0) / nights;
    return rate.toFixed(2);
  };

  // Convert reservations to CSV rows
  const rows = reservations.map((res) => [
    res.id || "",
    res.status || "",
    res.type?.name || "",
    res.contact?.name || "",
    formatDate(res.arrivalTime),
    formatDate(res.departureTime),
    res.nights || 0,
    getTotalOccupants(res.occupants),
    getOccupantCount(res.occupants, "adults"),
    getOccupantCount(res.occupants, "children"),
    calculateNightlyRate(res.ownerBreakdown?.grossRevenue, res.nights),
    res.ownerBreakdown?.grossRevenue || "0.00",
    res.ownerBreakdown?.netRevenue || "0.00",
    res.ownerBreakdown?.managerCommission || "0.00",
  ]);

  // Escape CSV fields
  const escapeCsvField = (field) => {
    if (field === null || field === undefined) return "";
    const str = String(field);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  // Build CSV content
  const csvContent = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(",")),
  ].join("\n");

  // Ensure output directory exists and write to file
  const path = require("path");
  const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, path.basename(outputFile));
  fs.writeFileSync(outputPath, csvContent, "utf8");
  console.log(`✓ CSV exported to: ${outputPath}`);
}

/**
 * Find the most recent reservations JSON file in output directory
 */
function findMostRecentReservationsFile() {
  const fs = require("fs");
  const path = require("path");
  const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");

  try {
    const files = fs
      .readdirSync(outputDir)
      .filter((f) => f.startsWith("reservations-") && f.endsWith(".json"))
      .map((f) => ({
        name: path.join(outputDir, f),
        time: fs.statSync(path.join(outputDir, f)).mtime.getTime(),
      }))
      .sort((a, b) => b.time - a.time);

    return files.length > 0 ? files[0].name : null;
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

// Main execution
function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
TrackHS Reservation Analysis Tool

Usage:
  node analyze.js [reservation-file.json] [options]

Options:
  --csv FILE         Export to CSV file
  --help, -h         Show this help message

Examples:
  # Analyze most recent reservations file
  node analyze.js

  # Analyze specific file
  node analyze.js reservations-2026.json

  # Analyze and export to CSV
  node analyze.js reservations-2026.json --csv reservations-2026.csv
`);
    process.exit(0);
  }

  let inputFile = args[0];
  const csvOutput = args[args.indexOf("--csv") + 1];

  // If no file provided, find the most recent one
  if (!inputFile || inputFile.startsWith("--")) {
    inputFile = findMostRecentReservationsFile();
    if (!inputFile) {
      console.error(
        "Error: No reservation JSON files found in output directory",
      );
      console.error("Usage: node analyze.js [reservation-file.json]");
      process.exit(1);
    }
    console.log(`Using most recent file: ${inputFile}\n`);
  } else {
    // If user provided a filename, look for it in output directory
    const path = require("path");
    const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");
    if (!inputFile.includes(path.sep)) {
      inputFile = path.join(outputDir, inputFile);
    }
  }

  try {
    console.log(`Loading reservations from: ${inputFile}`);
    const reservations = loadReservations(inputFile);

    console.log(`Loaded ${reservations.length} reservations`);

    // Analyze
    const analysis = analyzeReservations(reservations);
    printAnalysis(analysis);

    // Export to CSV if requested
    if (csvOutput) {
      exportToCsv(reservations, csvOutput);
    }
  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { analyzeReservations };
