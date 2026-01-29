#!/usr/bin/env node

/**
 * TrackHS Reservations to iCal Converter
 *
 * Converts JSON reservation files to iCal format and optionally uploads to S3.
 */

const fs = require("fs").promises;
const ical = require("ical-generator").default;
require("dotenv").config();

// Configuration
const CONFIG = {
  s3BucketName: process.env.S3_BUCKET_NAME,
  s3Region: process.env.S3_REGION || "us-west-2",
  s3Folder: process.env.S3_FOLDER || "radretreat",
  awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
};

/**
 * Get reservation emoji based on type and status
 */
function getReservationEmoji(reservation) {
  if (reservation.status === "Cancelled") return "❌";
  if (reservation.type?.ownerStay || reservation.type?.personalUse) return "🏠";
  if (reservation.type?.name?.toLowerCase().includes("airbnb")) return "🅰️";
  if (reservation.type?.name?.toLowerCase().includes("vrbo")) return "🆅";
  if (reservation.status === "Confirmed") return "✅";
  if (reservation.status === "Checked Out") return "✓";
  return "📅";
}

/**
 * Generate iCal file from reservations using ical-generator
 */
async function generateICalFile(reservations, year) {
  // Create calendar
  const calendar = ical({
    name: `Reservations ${year}`,
    prodId: {
      company: "TrackHS",
      product: "Reservations",
    },
    timezone: "UTC",
  });

  // Add events for each reservation
  reservations.forEach((reservation) => {
    const emoji = getReservationEmoji(reservation);
    const guestName = reservation.contact?.name || "Unknown Guest";
    const bookingSource = reservation.type?.name || "Unknown Source";
    const propertyName = reservation._embedded?.unit?.name || "Property";
    const nights = reservation.nights || 0;
    const status = reservation.status || "Unknown";

    // Create summary with emoji and guest name
    const summary = `${emoji} ${guestName}`;

    // Create detailed description
    const description = [
      `Guest: ${guestName}`,
      `Booking Source: ${bookingSource}`,
      `Property: ${propertyName}`,
      `Nights: ${nights}`,
      `Status: ${status}`,
      `Reservation ID: ${reservation.id}`,
    ].join("\n");

    // Determine event status
    let eventStatus = "TENTATIVE";
    if (status === "Confirmed") eventStatus = "CONFIRMED";
    if (status === "Cancelled") eventStatus = "CANCELLED";

    // Add event to calendar
    calendar.createEvent({
      id: `reservation-${reservation.id}@trackhs`,
      start: new Date(reservation.arrivalTime),
      end: new Date(reservation.departureTime),
      summary: summary,
      description: description,
      location: propertyName,
      status: eventStatus,
      transparency: "OPAQUE",
    });
  });

  return calendar.toString();
}

/**
 * Upload file to AWS S3
 */
async function uploadToS3(fileContent, fileName) {
  const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

  const bucketName = CONFIG.s3BucketName;
  const region = CONFIG.s3Region;
  const folder = CONFIG.s3Folder;
  const fileKey = folder ? `${folder}/${fileName}` : fileName;

  if (!bucketName) {
    console.log(
      "💡 Tip: Add S3 config to .env for auto-upload and easy calendar subscription",
    );
    return false;
  }

  if (!CONFIG.awsAccessKeyId || !CONFIG.awsSecretAccessKey) {
    console.log(
      "⚠️  AWS credentials not set (need AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY in .env)",
    );
    return false;
  }

  try {
    console.log(`\n📤 Uploading to S3: ${bucketName}/${fileKey}...`);

    // Create S3 client with credentials from environment
    const s3Client = new S3Client({
      region: region,
      credentials: {
        accessKeyId: CONFIG.awsAccessKeyId,
        secretAccessKey: CONFIG.awsSecretAccessKey,
      },
    });

    // Upload file with public read access
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: fileKey,
      Body: fileContent,
      ContentType: "text/calendar; charset=utf-8",
      CacheControl: "max-age=300", // 5 minutes cache
      ACL: "public-read", // Make file publicly accessible
    });

    await s3Client.send(command);

    const s3Url = `https://${bucketName}.s3.${region}.amazonaws.com/${fileKey}`;
    console.log("✅ Uploaded to S3!");
    console.log(`   📍 URL: ${s3Url}`);
    console.log(`   💡 Subscribe to this URL in your calendar app\n`);
    return true;
  } catch (error) {
    console.error("❌ S3 upload failed:", error.message);
    if (error.name === "NoSuchBucket") {
      console.error(
        `   Bucket "${bucketName}" does not exist or is not accessible`,
      );
    } else if (error.name === "InvalidAccessKeyId") {
      console.error("   AWS Access Key ID is invalid");
    } else if (error.name === "SignatureDoesNotMatch") {
      console.error("   AWS Secret Access Key is invalid");
    }
    console.error("   Check your S3 configuration in .env\n");
    return false;
  }
}

/**
 * Find all reservation JSON files
 */
async function findReservationFiles() {
  const path = require("path");
  const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");

  try {
    const files = await fs.readdir(outputDir);
    return files.filter(
      (f) => f.startsWith("reservations-") && f.endsWith(".json"),
    );
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * Extract year from filename
 */
function extractYear(filename) {
  const match = filename.match(/reservations-(\d{4})\.json/);
  return match ? match[1] : null;
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
TrackHS Reservations to iCal Converter

Usage:
  node src/reservations-to-ical.js [input-file.json] [options]
  npm run ical [-- input-file.json] [-- options]

Arguments:
  input-file.json            Input JSON file (default: process all reservations-*.json files)

Options:
  --no-upload                Skip S3 upload even if configured
  --help, -h                 Show this help message

Examples:
  # Convert all reservation files and upload to S3
  npm run ical

  # Convert specific file
  npm run ical -- reservations-2026.json

  # Convert without uploading
  npm run ical -- --no-upload

Environment Variables:
  Configure S3 upload in .env:
    S3_BUCKET_NAME, S3_REGION, S3_FOLDER,
    AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
`);
    process.exit(0);
  }

  try {
    const path = require("path");
    const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");

    // Ensure output directory exists
    await fs.mkdir(outputDir, { recursive: true });

    const skipUpload = args.includes("--no-upload");
    let filesToProcess = [];

    // Determine which files to process
    const specificFile = args.find(
      (arg) => !arg.startsWith("--") && arg.endsWith(".json"),
    );
    if (specificFile) {
      filesToProcess = [path.basename(specificFile)];
      console.log(`Processing: ${specificFile}\n`);
    } else {
      filesToProcess = await findReservationFiles();
      if (filesToProcess.length === 0) {
        console.error(
          "ERROR: No reservations-*.json files found in output directory",
        );
        process.exit(1);
      }
      console.log(
        `Found ${filesToProcess.length} reservation file(s) to process\n`,
      );
    }

    // Process each file
    for (const fileName of filesToProcess) {
      const year = extractYear(fileName);
      if (!year) {
        console.log(`⚠️  Skipping ${fileName} (could not extract year)`);
        continue;
      }

      console.log(`📅 Processing ${fileName}...`);

      // Read input JSON from output directory
      const inputFile = path.join(outputDir, fileName);
      const jsonData = await fs.readFile(inputFile, "utf8");
      const reservations = JSON.parse(jsonData);

      if (!Array.isArray(reservations)) {
        console.error(`   ✗ Invalid format (not an array)`);
        continue;
      }

      console.log(`   Found ${reservations.length} reservations`);

      // Generate iCal
      const icalContent = await generateICalFile(reservations, year);
      const outputFileName = `reservations-${year}.ics`;
      const outputFile = path.join(outputDir, outputFileName);

      // Write to file in output directory
      await fs.writeFile(outputFile, icalContent, "utf8");
      console.log(`   ✓ Created: ${outputFile}`);

      // Upload to S3 if configured and not skipped
      if (!skipUpload) {
        await uploadToS3(icalContent, outputFileName);
      }
    }

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
