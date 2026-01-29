#!/usr/bin/env node

/**
 * TrackHS Reservation Fetch Script
 *
 * Authenticates with TrackHS and retrieves all reservations for a given date range.
 * This script reverse-engineers the TrackHS API based on network traffic analysis.
 */

const https = require("https");
const fs = require("fs").promises;
const path = require("path");
require("dotenv").config();

const API_TOKEN_ENDPOINT = "/owner/api-token/";
const RESERVATIONS_ENDPOINT = "/api/v2/pms/reservations/";
const PAGE_SIZE = 100; // Max results per page

class TrackHSClient {
  constructor(domain) {
    if (!domain) {
      throw new Error(
        "TrackHS domain is required. Set TRACKHS_DOMAIN in .env or pass --domain",
      );
    }
    this.domain = domain;
    this.baseUrl = `${domain}.trackhs.com`;
    this.token = null;
    this.cookies = [];
  }

  /**
   * Make HTTPS request with proper headers that match real browser behavior
   */
  async makeRequest(options, postData = null) {
    return new Promise((resolve, reject) => {
      const defaultHeaders = {
        accept: "application/json, text/javascript, */*; q=0.01",
        "accept-encoding": "gzip, deflate, br, zstd",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        dnt: "1",
        pragma: "no-cache",
        "sec-ch-ua":
          '"Not(A:Brand";v="8", "Chromium";v="144", "Google Chrome";v="144"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        "x-requested-with": "XMLHttpRequest",
      };

      if (this.cookies.length > 0) {
        defaultHeaders["cookie"] = this.cookies.join("; ");
      }

      if (this.token) {
        defaultHeaders["authorization"] = `Bearer ${this.token}`;
      }

      const reqOptions = {
        hostname: this.baseUrl,
        ...options,
        headers: {
          ...defaultHeaders,
          ...options.headers,
        },
      };

      if (postData) {
        if (!reqOptions.headers["content-type"]) {
          reqOptions.headers["content-type"] = "application/json";
        }
        reqOptions.headers["content-length"] = Buffer.byteLength(postData);
      }

      const req = https.request(reqOptions, (res) => {
        // Store cookies from response
        const setCookies = res.headers["set-cookie"];
        if (setCookies) {
          setCookies.forEach((cookie) => {
            const cookieName = cookie.split("=")[0];
            // Update or add cookie
            this.cookies = this.cookies.filter(
              (c) => !c.startsWith(cookieName),
            );
            this.cookies.push(cookie.split(";")[0]);
          });
        }

        // Handle compressed responses
        const zlib = require("zlib");
        let stream = res;
        const encoding = res.headers["content-encoding"];

        if (encoding === "gzip") {
          stream = res.pipe(zlib.createGunzip());
        } else if (encoding === "deflate") {
          stream = res.pipe(zlib.createInflate());
        } else if (encoding === "br") {
          stream = res.pipe(zlib.createBrotliDecompress());
        }

        let data = "";
        stream.on("data", (chunk) => {
          data += chunk;
        });

        stream.on("end", () => {
          try {
            const jsonData = JSON.parse(data);
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: jsonData,
            });
          } catch (e) {
            // Not JSON - return as string (HTML, etc.)
            resolve({
              status: res.statusCode,
              headers: res.headers,
              data: data,
            });
          }
        });

        stream.on("error", (error) => {
          reject(error);
        });
      });

      req.on("error", (error) => {
        reject(error);
      });

      if (postData) {
        req.write(postData);
      }

      req.end();
    });
  }

  /**
   * Authenticate and get session token
   * Note: This assumes you're already logged in via browser and have session cookies
   * For fresh authentication, you'd need to implement the login flow
   */
  async getApiToken() {
    console.log("Fetching API token...");

    const response = await this.makeRequest({
      method: "GET",
      path: API_TOKEN_ENDPOINT,
      headers: {
        referer: `https://${this.baseUrl}/owner/`,
      },
    });

    if (response.status !== 200) {
      throw new Error(`Failed to get API token. Status: ${response.status}`);
    }

    if (!response.data.success || !response.data.token) {
      throw new Error(
        "API token request failed or token not found in response",
      );
    }

    this.token = response.data.token;
    console.log("Successfully obtained API token");
    console.log(`Token expires: ${response.data.expiresAt}`);

    return this.token;
  }

  /**
   * Extract CSRF security token from login page HTML
   */
  extractSecurityToken(html) {
    // Look for security token in various possible formats
    // The token is in a hidden input: <input type="hidden" name="security" value="...">
    const patterns = [
      /<input[^>]*name=["']security["'][^>]*value=["']([^"']+)["']/i,
      /<input[^>]*value=["']([^"']+)["'][^>]*name=["']security["']/i,
      /name=["']security["'][^>]*value=["']([^"']+)["']/i,
      /security["']\s+value=["']([^"']+)["']/i,
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }

    throw new Error("Could not extract security token from login page");
  }

  /**
   * Login to TrackHS using username and password
   *
   * This implements the two-step login process:
   * 1. GET /owner/ to retrieve the CSRF security token
   * 2. POST /owner/ with username, password, and security token
   */
  async login(username, password) {
    console.log("Fetching login page to get security token...");

    // Step 1: GET the login page to extract CSRF token
    const loginPageResponse = await this.makeRequest({
      method: "GET",
      path: "/owner/",
      headers: {
        accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
        "sec-fetch-user": "?1",
        "upgrade-insecure-requests": "1",
      },
    });

    if (loginPageResponse.status !== 200) {
      throw new Error(
        `Failed to fetch login page. Status: ${loginPageResponse.status}`,
      );
    }

    // Extract security token from HTML
    const securityToken = this.extractSecurityToken(loginPageResponse.data);
    console.log("Security token obtained");

    // Step 2: POST credentials with security token
    console.log("Attempting to login...");

    const formData = new URLSearchParams({
      username: username,
      password: password,
      security: securityToken,
    });

    const loginResponse = await this.makeRequest(
      {
        method: "POST",
        path: "/owner/",
        headers: {
          accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "content-type": "application/x-www-form-urlencoded",
          origin: `https://${this.baseUrl}`,
          referer: `https://${this.baseUrl}/owner/`,
          "sec-fetch-dest": "document",
          "sec-fetch-mode": "navigate",
          "sec-fetch-site": "same-origin",
          "sec-fetch-user": "?1",
          "upgrade-insecure-requests": "1",
        },
      },
      formData.toString(),
    );

    // Successful login returns 302 redirect to /owner/dashboard/
    if (loginResponse.status === 302) {
      const location = loginResponse.headers["location"];
      if (
        location &&
        (location.includes("/owner/dashboard") || location.includes("/owner/"))
      ) {
        console.log("Login successful");
        return true;
      }
    }

    // Check for error messages in response
    if (loginResponse.status === 200) {
      // Still on login page means auth failed
      if (
        typeof loginResponse.data === "string" &&
        (loginResponse.data.includes("Invalid") ||
          loginResponse.data.includes("incorrect") ||
          loginResponse.data.includes("login"))
      ) {
        throw new Error("Login failed: Invalid username or password");
      }
    }

    throw new Error(`Login failed with status ${loginResponse.status}`);
  }

  /**
   * Fetch reservations with pagination
   */
  async fetchReservations(options = {}) {
    const {
      startDate = "",
      endDate = "",
      unitId = "",
      search = "",
      page = 1,
      pageSize = PAGE_SIZE,
      sortColumn = "id",
      sortDirection = "asc",
    } = options;

    const queryParams = new URLSearchParams({
      draw: page,
      search: search,
      startDateRange: startDate,
      endDateRange: endDate,
      unitId: unitId,
      size: pageSize,
      page: page,
      sortColumn: sortColumn,
      sortDirection: sortDirection,
      _: Date.now(),
    });

    const response = await this.makeRequest({
      method: "GET",
      path: `${RESERVATIONS_ENDPOINT}?${queryParams.toString()}`,
      headers: {
        referer: `https://${this.baseUrl}/owner/reservations/`,
        priority: "u=1, i",
      },
    });

    if (response.status !== 200) {
      throw new Error(
        `Failed to fetch reservations. Status: ${response.status}`,
      );
    }

    return response.data;
  }

  /**
   * Sleep for specified milliseconds (for rate limiting)
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Fetch all reservations for a date range
   */
  async fetchAllReservations(startDate, endDate) {
    console.log(`Fetching all reservations from ${startDate} to ${endDate}...`);

    const allReservations = [];
    let currentPage = 1;
    let totalPages = 1;

    do {
      console.log(`Fetching page ${currentPage}...`);

      const data = await this.fetchReservations({
        startDate: startDate,
        endDate: endDate,
        page: currentPage,
        pageSize: PAGE_SIZE,
      });

      if (data._embedded && data._embedded.reservations) {
        const reservations = data._embedded.reservations;
        allReservations.push(...reservations);
        console.log(
          `Retrieved ${reservations.length} reservations from page ${currentPage}`,
        );
      }

      // Calculate total pages from response
      if (data.total && data.size) {
        totalPages = Math.ceil(data.total / data.size);
      }

      currentPage++;

      // Add small delay between requests to avoid rate limiting
      // and mimic human behavior (500ms-1000ms delay)
      if (currentPage <= totalPages) {
        const delay = 500 + Math.random() * 500;
        await this.sleep(delay);
      }
    } while (currentPage <= totalPages);

    console.log(`\nTotal reservations retrieved: ${allReservations.length}`);
    return allReservations;
  }

  /**
   * Save reservations to JSON file
   */
  async saveReservations(reservations, filename) {
    // Use OUTPUT_DIR env var if set (for Docker), otherwise use 'output'
    const outputDir = path.resolve(process.env.OUTPUT_DIR || "output");
    await fs.mkdir(outputDir, { recursive: true });

    // Save to output directory
    const filepath = path.join(outputDir, path.basename(filename));
    await fs.writeFile(filepath, JSON.stringify(reservations, null, 2));
    console.log(`Reservations saved to: ${filepath}`);
  }
}

/**
 * Main execution
 */
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
TrackHS Reservation Fetch Script

Usage:
  node src/fetch-reservations.js [options]
  npm run fetch [-- options]

Options:
  --start-date YYYY-MM-DD    Start date for reservation search (default: Jan 1 of current year)
  --end-date YYYY-MM-DD      End date for reservation search (default: Dec 31 of current year)
  --output FILE              Output filename (default: reservations-YYYY.json)
  --domain DOMAIN            TrackHS domain prefix (REQUIRED - set in .env or via --domain)
  --username USERNAME        Username for authentication
  --password PASSWORD        Password for authentication
  --session-cookie COOKIE    Use existing session cookie instead of login
  --help, -h                 Show this help message

Environment Variables:
  All options can be set via .env file or environment variables:
    TRACKHS_USERNAME, TRACKHS_PASSWORD, TRACKHS_DOMAIN,
    TRACKHS_START_DATE, TRACKHS_END_DATE, TRACKHS_OUTPUT_FILE

Examples:
  # Using .env file (recommended)
  cp .env.template .env
  # Edit .env with your credentials
  npm run fetch

  # Using command-line arguments
  npm run fetch -- --username your@email.com --password yourpass

  # Fetch specific date range
  npm run fetch -- --start-date 2026-01-01 --end-date 2026-06-30

  # Use session cookie (alternative)
  npm run fetch -- --session-cookie "TrackOwner=abc123..."

Note:
  This script authenticates via username/password by:
  1. Fetching the login page to extract CSRF security token
  2. Posting credentials with the security token
  3. Using the resulting session to fetch reservations
`);
    process.exit(0);
  }

  // Parse arguments with environment variable fallbacks
  const currentYear = new Date().getFullYear();
  const startDate =
    args[args.indexOf("--start-date") + 1] ||
    process.env.TRACKHS_START_DATE ||
    `${currentYear}-01-01`;
  const endDate =
    args[args.indexOf("--end-date") + 1] ||
    process.env.TRACKHS_END_DATE ||
    `${currentYear}-12-31`;
  const outputFile =
    args[args.indexOf("--output") + 1] ||
    process.env.TRACKHS_OUTPUT_FILE ||
    `reservations-${currentYear}.json`;
  const domain =
    args[args.indexOf("--domain") + 1] || process.env.TRACKHS_DOMAIN;
  const username =
    args[args.indexOf("--username") + 1] || process.env.TRACKHS_USERNAME;
  const password =
    args[args.indexOf("--password") + 1] || process.env.TRACKHS_PASSWORD;
  const sessionCookie =
    args[args.indexOf("--session-cookie") + 1] ||
    process.env.TRACKHS_SESSION_COOKIE;

  try {
    const client = new TrackHSClient(domain);

    // Authenticate
    if (sessionCookie) {
      console.log("Using provided session cookie...");
      client.cookies = [sessionCookie];
    } else if (username && password) {
      await client.login(username, password);
    } else {
      console.error("ERROR: Authentication required.");
      console.error(
        "Please provide either --session-cookie or --username and --password",
      );
      console.error("Run with --help for more information");
      process.exit(1);
    }

    // Get API token
    await client.getApiToken();

    // Fetch all reservations
    const reservations = await client.fetchAllReservations(startDate, endDate);

    // Save to JSON file
    await client.saveReservations(reservations, outputFile);

    console.log("\n✓ Done!");
    console.log(`Retrieved ${reservations.length} reservations`);

    // Print summary
    if (reservations.length > 0) {
      const summary = reservations.reduce(
        (acc, res) => {
          acc.totalNights += res.nights || 0;
          acc.totalRevenue += parseFloat(res.ownerBreakdown?.grossRevenue || 0);
          return acc;
        },
        { totalNights: 0, totalRevenue: 0 },
      );

      console.log("\nSummary:");
      console.log(`  Total nights: ${summary.totalNights}`);
      console.log(`  Total revenue: $${summary.totalRevenue.toFixed(2)}`);
    }
  } catch (error) {
    console.error("\n✗ Error:", error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { TrackHSClient };
