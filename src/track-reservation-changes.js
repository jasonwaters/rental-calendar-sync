#!/usr/bin/env node

/**
 * Reservation Change Tracker
 *
 * Compares a reservations snapshot against prior state and records:
 * - additions
 * - changes
 * - removals (after configurable missing threshold)
 *
 * Outputs:
 * - output/audit/state-YYYY.json
 * - output/audit/changes-YYYY.ndjson
 * - output/audit/reservation-changelog.ndjson
 * - output/audit/changes-YYYY.md
 */

const fs = require("fs").promises;
const path = require("path");
const crypto = require("crypto");
const dayjs = require("dayjs");
const { diff: jsonDiff } = require("jsondiffpatch");
const NOISE_ONLY_FIELDS = new Set(["updatedAt"]);

function getOccupantCount(occupants, type) {
  if (!Array.isArray(occupants)) return 0;
  const occupant = occupants.find(
    (occ) => occ.handle === type || occ.name?.toLowerCase() === type,
  );
  return occupant ? occupant.quantity || 0 : 0;
}

function getTotalOccupants(occupants) {
  if (!Array.isArray(occupants)) return 0;
  return occupants.reduce((sum, occ) => sum + (occ.quantity || 0), 0);
}

function parseMoney(value) {
  const number = parseFloat(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeReservation(reservation) {
  return {
    id: String(reservation.id || ""),
    status: reservation.status || "",
    bookingSource: reservation.type?.name || reservation.source || "",
    guest: reservation.contact?.name || "",
    unitId: reservation.unitId || "",
    unitName: reservation._embedded?.unit?.name || "",
    arrivalDate: reservation.arrivalDate || "",
    departureDate: reservation.departureDate || "",
    arrivalTime: reservation.arrivalTime || "",
    departureTime: reservation.departureTime || "",
    nights: reservation.nights || 0,
    totalOccupants: getTotalOccupants(reservation.occupants),
    adults: getOccupantCount(reservation.occupants, "adults"),
    children: getOccupantCount(reservation.occupants, "children"),
    grossRevenue: parseMoney(reservation.ownerBreakdown?.grossRevenue),
    netRevenue: parseMoney(reservation.ownerBreakdown?.netRevenue),
    managerCommission: parseMoney(
      reservation.ownerBreakdown?.managerCommission,
    ),
    cancelledAt: reservation.cancelledAt || "",
    updatedAt: reservation.updatedAt || "",
  };
}

function hashTrackedFields(trackedFields) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(trackedFields))
    .digest("hex");
}

function listChangedFields(before, after) {
  const fields = [];

  for (const key of Object.keys(after)) {
    if (before[key] !== after[key]) {
      fields.push(key);
    }
  }

  return fields;
}

function filterMeaningfulFields(fields) {
  return fields.filter((field) => !NOISE_ONLY_FIELDS.has(field));
}

async function readJsonFile(filePath, fallback) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function appendNdjson(filePath, events) {
  if (!events.length) return;
  const lines = events.map((event) => JSON.stringify(event)).join("\n") + "\n";
  await fs.appendFile(filePath, lines, "utf8");
}

async function findMostRecentReservationsFile(outputDir) {
  const files = await fs.readdir(outputDir);
  const candidates = files.filter(
    (file) => /^reservations-\d{4}\.json$/.test(file),
  );

  if (!candidates.length) {
    return null;
  }

  const filesWithStats = await Promise.all(
    candidates.map(async (file) => {
      const fullPath = path.join(outputDir, file);
      const stats = await fs.stat(fullPath);
      return { file, mtime: stats.mtime.getTime() };
    }),
  );

  filesWithStats.sort((a, b) => b.mtime - a.mtime);
  return filesWithStats[0].file;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

function extractYear(fileName) {
  const match = fileName.match(/reservations-(\d{4})\.json$/);
  return match ? match[1] : null;
}

function formatValue(value) {
  if (value === null || value === undefined || value === "") return "(empty)";
  if (typeof value === "number") return String(value);
  return String(value);
}

function formatMoney(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function escapeMarkdownCell(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\n/g, " ");
}

function getReservationForEvent(event) {
  return event.after || event.before || {};
}

function formatDateTimeCompact(timestamp) {
  const parsed = dayjs(timestamp);
  if (!parsed.isValid()) return "(empty)";
  return parsed.format("MMM D h:mm A");
}

function formatStay(arrivalDate, departureDate) {
  const arrival = dayjs(arrivalDate);
  const departure = dayjs(departureDate);
  if (!arrival.isValid() || !departure.isValid()) {
    return `${arrivalDate || "(empty)"} - ${departureDate || "(empty)"}`;
  }
  if (arrival.month() === departure.month()) {
    return `${arrival.format("MMM D")} - ${departure.format("D")}`;
  }
  return `${arrival.format("MMM D")} - ${departure.format("MMM D")}`;
}

function mapAction(eventType) {
  if (eventType === "added" || eventType === "restored") return "ADDED";
  if (eventType === "changed") return "MODIFIED";
  if (eventType === "removed") return "REMOVED";
  return String(eventType || "UNKNOWN").toUpperCase();
}

function buildChangeDetails(event) {
  if (event.type === "removed") return "Reservation removed from current snapshot.";
  if (event.type === "added") return "New reservation created.";
  if (event.type === "restored") return "Reservation restored after prior removal.";
  if (event.type !== "changed" || !Array.isArray(event.fields) || !event.fields.length) {
    return "";
  }
  return event.fields
    .map((field) => {
      if (field === "updatedAt") {
        return `Reservation Updated: ${formatDateTimeCompact(event.before?.[field])} -> ${formatDateTimeCompact(event.after?.[field])}`;
      }
      return `${field}: ${formatValue(event.before?.[field])} -> ${formatValue(event.after?.[field])}`;
    })
    .join("<br>");
}

function buildLedgerRow(event, index) {
  const reservation = getReservationForEvent(event);
  const stay = formatStay(reservation.arrivalDate, reservation.departureDate);
  const occupancy = `${reservation.totalOccupants || 0} (A:${reservation.adults || 0}/C:${reservation.children || 0})`;
  const details = buildChangeDetails(event);

  const cols = [
    index + 1,
    formatDateTimeCompact(event.ts || ""),
    mapAction(event.type),
    event.id || "",
    reservation.guest || "Unknown Guest",
    stay,
    reservation.status || "(empty)",
    reservation.bookingSource || "(empty)",
    reservation.nights || 0,
    occupancy,
    formatMoney(reservation.grossRevenue),
    formatMoney(reservation.netRevenue),
    formatDateTimeCompact(reservation.updatedAt || ""),
    details,
  ];

  return `| ${cols.map((c) => escapeMarkdownCell(c)).join(" | ")} |`;
}

function buildYearLedgerMarkdown(year, events) {
  const lines = [];
  const sortedEvents = [...events].sort(
    (a, b) => new Date(b.ts || 0).getTime() - new Date(a.ts || 0).getTime(),
  );

  lines.push(`# Reservation Change Ledger (${year})`);
  lines.push("");
  lines.push(`- Total events: ${sortedEvents.length}`);
  lines.push(`- Generated: ${formatDateTimeCompact(new Date().toISOString())}`);
  lines.push("");
  lines.push(
    "| # | Detected | Action | Reservation ID | Guest | Stay | Status | Source | Nights | Occupancy | Gross | Net | Reservation Updated | Change Details |",
  );
  lines.push(
    "| ---: | --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: | ---: | --- | --- |",
  );

  if (!sortedEvents.length) {
    lines.push("| 1 | - | - | - | - | - | - | - | - | - | - | - | - | No changes recorded for this year. |");
    lines.push("");
    return lines.join("\n");
  }

  sortedEvents.forEach((event, index) => {
    lines.push(buildLedgerRow(event, index));
  });
  lines.push("");
  return lines.join("\n");
}

async function readNdjson(filePath) {
  try {
    const content = await fs.readFile(filePath, "utf8");
    return content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function cleanupLegacyMarkdownFiles(auditDir, year) {
  const files = await fs.readdir(auditDir);
  const legacyPattern = new RegExp(
    `^changes-${year}-(latest|history|\\d{4}-.*)\\.md$`,
  );
  const targets = files.filter((file) => legacyPattern.test(file));
  await Promise.all(targets.map((file) => fs.unlink(path.join(auditDir, file))));
  return targets.length;
}

function printHelp() {
  console.log(`
Reservation Change Tracker

Usage:
  node src/track-reservation-changes.js [input-file.json] [options]
  npm run changes [-- input-file.json] [-- options]

Arguments:
  input-file.json               Input JSON file in output directory
                                (default: most recent reservations-YYYY.json)

Options:
  --year YYYY                   Force year partition (default: infer from filename)
  --previous-file FILE          Compare against previous snapshot in output directory
                                (used for bootstrapping when no state file exists)
  --force-bootstrap             Use --previous-file/bootstrap snapshot even when state exists
  --missing-threshold N         Runs missing before "removed" event (default: 2)
  --help, -h                    Show help

Outputs:
  output/audit/state-YYYY.json
  output/audit/changes-YYYY.ndjson
  output/audit/reservation-changelog.ndjson
  output/audit/changes-YYYY.md
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    process.exit(0);
  }

  const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");
  const auditDir = path.join(outputDir, "audit");
  await fs.mkdir(auditDir, { recursive: true });

  const yearArgIndex = args.indexOf("--year");
  const previousFileArgIndex = args.indexOf("--previous-file");
  const forceBootstrap = args.includes("--force-bootstrap");
  const thresholdArgIndex = args.indexOf("--missing-threshold");

  const explicitYear =
    yearArgIndex !== -1 && args[yearArgIndex + 1] ? args[yearArgIndex + 1] : "";
  const missingThresholdRaw =
    thresholdArgIndex !== -1 && args[thresholdArgIndex + 1]
      ? parseInt(args[thresholdArgIndex + 1], 10)
      : 2;
  const missingThreshold =
    Number.isInteger(missingThresholdRaw) && missingThresholdRaw > 0
      ? missingThresholdRaw
      : 2;
  const explicitPreviousFile =
    previousFileArgIndex !== -1 && args[previousFileArgIndex + 1]
      ? args[previousFileArgIndex + 1]
      : "";

  let inputFileName = args[0];
  if (!inputFileName || inputFileName.startsWith("--")) {
    inputFileName = await findMostRecentReservationsFile(outputDir);
    if (!inputFileName) {
      console.error("ERROR: No reservations-YYYY.json files found in output/");
      process.exit(1);
    }
    console.log(`Using most recent file: ${inputFileName}`);
  }

  const inputFilePath = path.join(outputDir, path.basename(inputFileName));
  const reservations = await readJsonFile(inputFilePath, null);
  if (!Array.isArray(reservations)) {
    console.error("ERROR: Input file does not contain a reservation array");
    process.exit(1);
  }

  const inferredYear = extractYear(path.basename(inputFilePath));
  const year = explicitYear || inferredYear || String(new Date().getFullYear());
  const runAt = new Date().toISOString();

  const statePath = path.join(auditDir, `state-${year}.json`);
  const yearLogPath = path.join(auditDir, `changes-${year}.ndjson`);
  const globalLogPath = path.join(auditDir, "reservation-changelog.ndjson");
  const markdownPath = path.join(auditDir, `changes-${year}.md`);

  const hasStateFile = await fileExists(statePath);
  const priorState = await readJsonFile(statePath, {
    year,
    updatedAt: null,
    missingThreshold,
    reservations: {},
  });
  let priorReservations = priorState.reservations || {};

  // Optional bootstrap path: compare against previous snapshot when state is missing.
  if (!hasStateFile || forceBootstrap) {
    let bootstrapFile = "";

    if (explicitPreviousFile) {
      bootstrapFile = path.join(outputDir, path.basename(explicitPreviousFile));
    } else {
      const inferredBootstrap = path.join(outputDir, `reservations-b-${year}.json`);
      if (await fileExists(inferredBootstrap)) {
        bootstrapFile = inferredBootstrap;
      }
    }

    if (bootstrapFile) {
      const previousReservations = await readJsonFile(bootstrapFile, null);
      if (!Array.isArray(previousReservations)) {
        console.error(
          "ERROR: --previous-file does not contain a reservation array",
        );
        process.exit(1);
      }

      const bootstrapMap = {};
      for (const reservation of previousReservations) {
        const rawId = reservation.id;
        if (rawId === undefined || rawId === null || rawId === "") continue;
        const id = String(rawId);
        const tracked = normalizeReservation(reservation);
        bootstrapMap[id] = {
          id,
          hash: hashTrackedFields(tracked),
          tracked,
          firstSeenAt: runAt,
          lastSeenAt: runAt,
          missingCount: 0,
          removedAt: null,
        };
      }

      priorReservations = bootstrapMap;
      console.log(
        `Bootstrapping comparison from previous snapshot: ${path.basename(bootstrapFile)}`,
      );
    }
  }

  const nextReservations = {};
  const added = [];
  const changed = [];
  const removed = [];
  const restored = [];
  const pendingMissing = [];
  let skippedWithoutId = 0;

  for (const reservation of reservations) {
    const rawId = reservation.id;
    if (rawId === undefined || rawId === null || rawId === "") {
      skippedWithoutId += 1;
      continue;
    }

    const id = String(rawId);
    const tracked = normalizeReservation(reservation);
    const hash = hashTrackedFields(tracked);
    const existing = priorReservations[id];

    const nextRecord = {
      id,
      hash,
      tracked,
      firstSeenAt: existing?.firstSeenAt || runAt,
      lastSeenAt: runAt,
      missingCount: 0,
      removedAt: null,
    };

    if (!existing) {
      added.push({
        ts: runAt,
        type: "added",
        id,
        year,
        affectedYears: [Number(year)],
        after: tracked,
      });
    } else if (existing.removedAt) {
      restored.push({
        ts: runAt,
        type: "restored",
        id,
        year,
        affectedYears: [Number(year)],
        before: existing.tracked,
        after: tracked,
      });
    } else if (existing.hash !== hash) {
      const delta = jsonDiff(existing.tracked, tracked);
      const fields = listChangedFields(existing.tracked, tracked);
      const meaningfulFields = filterMeaningfulFields(fields);
      if (meaningfulFields.length > 0) {
        changed.push({
          ts: runAt,
          type: "changed",
          id,
          year,
          affectedYears: [Number(year)],
          fields: meaningfulFields,
          delta: delta || {},
          before: existing.tracked,
          after: tracked,
        });
      }
    }

    nextReservations[id] = nextRecord;
  }

  for (const [id, existing] of Object.entries(priorReservations)) {
    if (nextReservations[id]) continue;

    const missingCount = (existing.missingCount || 0) + 1;
    const missingRecord = {
      ...existing,
      missingCount,
    };

    if (!existing.removedAt && missingCount >= missingThreshold) {
      missingRecord.removedAt = runAt;
      removed.push({
        ts: runAt,
        type: "removed",
        id,
        year,
        affectedYears: [Number(year)],
        before: existing.tracked,
      });
    } else if (!existing.removedAt) {
      pendingMissing.push({ id, missingCount });
    }

    nextReservations[id] = missingRecord;
  }

  const allEvents = [...added, ...changed, ...removed, ...restored];
  await appendNdjson(yearLogPath, allEvents);
  await appendNdjson(globalLogPath, allEvents);

  const nextState = {
    year,
    updatedAt: runAt,
    missingThreshold,
    reservations: nextReservations,
    stats: {
      currentRunReservationCount: reservations.length,
      trackedReservationCount: Object.keys(nextReservations).length,
      skippedWithoutId,
    },
  };
  await fs.writeFile(statePath, JSON.stringify(nextState, null, 2), "utf8");

  const eventsForYear = await readNdjson(yearLogPath);
  const markdown = buildYearLedgerMarkdown(year, eventsForYear);
  await fs.writeFile(markdownPath, markdown, "utf8");
  const removedLegacyMarkdownCount = await cleanupLegacyMarkdownFiles(
    auditDir,
    year,
  );

  console.log(`✓ State updated: ${statePath}`);
  console.log(`✓ Year changelog: ${yearLogPath}`);
  console.log(`✓ Global changelog: ${globalLogPath}`);
  console.log(`✓ Year ledger markdown: ${markdownPath}`);
  if (removedLegacyMarkdownCount > 0) {
    console.log(`✓ Removed ${removedLegacyMarkdownCount} legacy markdown file(s)`);
  }
  console.log("");
  console.log(`Added: ${added.length}`);
  console.log(`Changed: ${changed.length}`);
  console.log(`Removed: ${removed.length}`);
  console.log(`Restored: ${restored.length}`);
  console.log(`Missing below threshold: ${pendingMissing.length}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exit(1);
  });
}
