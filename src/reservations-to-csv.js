#!/usr/bin/env node

/**
 * TrackHS Reservations to CSV Converter
 *
 * Converts JSON reservation files to CSV format with formatted columns.
 */

const fs = require("fs").promises;
const path = require("path");
const dayjs = require("dayjs");

/**
 * Format date to human-readable format using dayjs
 * Format: "Friday, January 02, 2026 4:00 PM"
 */
function formatDate(dateString) {
  if (!dateString) return "";
  try {
    return dayjs(dateString).format("dddd, MMMM DD, YYYY h:mm A");
  } catch (e) {
    return dateString;
  }
}

/**
 * Get occupant count by type
 */
function getOccupantCount(occupants, type) {
  if (!occupants || !Array.isArray(occupants)) return 0;
  const occupant = occupants.find(
    (occ) => occ.handle === type || occ.name === type,
  );
  return occupant ? occupant.quantity || 0 : 0;
}

/**
 * Get total occupants
 */
function getTotalOccupants(occupants) {
  if (!occupants || !Array.isArray(occupants)) return 0;
  return occupants.reduce((total, occ) => total + (occ.quantity || 0), 0);
}

/**
 * Escape CSV field
 */
function escapeCsvField(field) {
  if (field === null || field === undefined) return "";
  const str = String(field);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Calculate nightly rate
 */
function calculateNightlyRate(grossRevenue, nights) {
  if (!nights || nights === 0) return "0.00";
  const rate = parseFloat(grossRevenue || 0) / nights;
  return rate.toFixed(2);
}

/**
 * Export reservations to CSV
 */
async function exportToCsv(reservations, outputPath) {
  // CSV Headers
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

  // Build CSV rows
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

  // Build CSV content
  const csvContent = [
    headers.map(escapeCsvField).join(","),
    ...rows.map((row) => row.map(escapeCsvField).join(",")),
  ].join("\n");

  // Write to file
  await fs.writeFile(outputPath, csvContent, "utf8");
  console.log(`✓ CSV exported to: ${outputPath}`);
  return outputPath;
}

/**
 * Find most recent reservations JSON file in output directory
 */
async function findMostRecentReservationsFile() {
  const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");

  try {
    const files = await fs.readdir(outputDir);
    const reservationFiles = files.filter(
      (f) => f.startsWith("reservations-") && f.endsWith(".json"),
    );

    if (reservationFiles.length === 0) {
      return null;
    }

    // Get file stats and sort by modification time
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
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
TrackHS Reservations to CSV Converter

Usage:
  node src/reservations-to-csv.js [input-file.json] [options]
  npm run csv [-- input-file.json] [-- options]

Arguments:
  input-file.json            Input JSON file (default: most recent reservations-*.json)

Options:
  --output FILE              Output CSV filename (default: same as input with .csv extension)
  --help, -h                 Show this help message

Examples:
  # Convert most recent reservations file
  npm run csv

  # Convert specific file
  npm run csv -- reservations-2026.json

  # Specify output filename
  npm run csv -- reservations-2026.json --output my-report.csv
`);
    process.exit(0);
  }

  try {
    const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    // Determine input file
    let inputFileName = args[0];
    if (!inputFileName || inputFileName.startsWith("--")) {
      // No file provided or first arg is an option, find most recent
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

    // Construct full input path
    const inputFile = path.join(outputDir, path.basename(inputFileName));

    // Determine output file
    const outputFileIndex = args.indexOf("--output");
    let outputFile;
    if (outputFileIndex !== -1 && args[outputFileIndex + 1]) {
      outputFile = path.join(
        outputDir,
        path.basename(args[outputFileIndex + 1]),
      );
    } else {
      outputFile = inputFile.replace(".json", ".csv");
    }

    // Read input JSON
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

    // Convert to CSV
    await exportToCsv(reservations, outputFile);

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

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = {
  exportToCsv,
  formatDate,
  getOccupantCount,
  getTotalOccupants,
};
