# Rental Calendar Sync

![Docker Build](https://github.com/jasonwaters/rental-calendar-sync/actions/workflows/publish-docker.yml/badge.svg)

Sync rental property reservations to your calendar with automatic iCal generation, CSV export, and statistical analysis. Currently supports TrackHS property management system.

Since TrackHS doesn't provide a public API, this tool reverse-engineers their internal API endpoints to fetch reservation data.

## Features

- 🔐 Authenticate with TrackHS using username and password
- 📥 Retrieve all reservations for a specified date range
- 🔄 Automatic pagination handling
- 🧾 Year-partitioned reservation change tracking (add/changed/removed)
- 🛡️ CSRF token extraction and handling
- 💾 Export to multiple formats:
  - **JSON** - Raw data with all details
  - **CSV** - Spreadsheet-friendly format
  - **iCal** - Calendar subscription format
- 📊 Statistical analysis (revenue, occupancy, booking sources)
- ☁️ Optional AWS S3 upload for calendar sync
- 🐳 Docker support for easy deployment
- 🚀 **Automated CI/CD** - GitHub Actions automatically builds and publishes on every push

## Project Structure

```
rental-calendar-sync/
├── src/                          # Source code
│   ├── fetch-reservations.js     # Fetch from TrackHS API
│   ├── reservations-to-csv.js    # Convert to CSV
│   ├── reservations-to-ical.js   # Convert to iCal
│   └── analyze.js                # Statistical analysis
├── output/                        # Output files (auto-created)
│   ├── reservations-YYYY.json    # Raw API data
│   ├── reservations-YYYY.csv     # Spreadsheet format
│   ├── reservations-YYYY.ics     # Calendar format
│   └── audit/                    # Change tracking outputs
│       ├── state-YYYY.json       # Per-year state store
│       ├── changes-YYYY.ndjson   # Per-year event log
│       ├── changes-YYYY.md       # Per-year cumulative ledger (all runs)
│       └── reservation-changelog.ndjson # Global append-only log
├── docs/                          # Documentation
│   ├── API-DOCUMENTATION.md
│   ├── AUTH-IMPLEMENTATION.md
│   ├── DOCKER.md
│   ├── ICAL-SYNC.md
│   └── SECURITY.md
├── .env.template                  # Configuration template
├── Dockerfile                     # Docker image
└── docker-compose.yml             # Docker Compose config
```

## Prerequisites

- Node.js 14.0.0 or higher
- An active TrackHS account with valid credentials

**OR**

- Docker (for containerized usage - see [Docker Guide](docs/DOCKER.md))

## Installation

### Option 1: Local Installation (Node.js)

```bash
cd rental-calendar-sync
npm install
```

This will install the required dependencies:

- `dotenv` - Environment variable management from .env files
- `dayjs` - Fast 2kB date utility library for date formatting
- `ical-generator` - iCalendar file generation
- `@aws-sdk/client-s3` - AWS S3 upload for calendar sync (optional)

## Configuration

1. Copy the environment template:

```bash
cp .env.template .env
```

2. Edit `.env` and add your TrackHS credentials:

```
TRACKHS_USERNAME=your@email.com
TRACKHS_PASSWORD=yourpassword
TRACKHS_DOMAIN=your-domain-here
```

Alternatively, you can provide credentials via command-line arguments.

### Option 2: Docker Installation

Docker provides an isolated, portable environment that works on any computer.

#### Quick Start with Docker

```bash
# Build the image
docker build -t rental-calendar-sync:latest .

# Create output directory
mkdir -p output

# Fetch reservations
docker run --rm \
  -v "$(pwd)/.env:/app/.env:ro" \
  -v "$(pwd)/output:/data" \
  rental-calendar-sync:latest npm run fetch
```

#### 🚀 Automated Scheduling on Synology NAS

Want to automatically sync every 12 hours on your Synology NAS? See the **[Docker Quick Start Guide](docs/DOCKER-QUICKSTART.md)** for a fast-track setup!

**Docker Documentation:**

- **[Docker Quick Start](docs/DOCKER-QUICKSTART.md)** - ⭐ Fast setup: Publish to GitHub + Schedule on Synology
- [Complete Docker Guide](docs/DOCKER.md) - Building, running, best practices
- [GitHub Publishing Guide](docs/GITHUB-PACKAGES.md) - Detailed GHCR publishing instructions
- [Synology Setup Guide](docs/SYNOLOGY-SETUP.md) - Complete Synology configuration and troubleshooting

**CI/CD:**

- GitHub Actions automatically builds and publishes Docker images on every push to `main`
- See [.github/workflows/README.md](.github/workflows/README.md) for details

## Usage

All output files (JSON, CSV, iCal) are saved to the `output/` directory.

### Quick Start

The easiest way to get started is using npm scripts with `.env` configuration:

```bash
# 1. Fetch reservations (creates output/reservations-YYYY.json)
npm run fetch

# 2. Convert to CSV (creates output/reservations-YYYY.csv)
npm run csv

# 3. Track reservation changes (creates output/audit/*)
npm run changes

# 4. Generate iCal for calendar sync (creates output/reservations-YYYY.ics)
npm run ical

# 5. Analyze your data
npm run analyze
```

### Fetch Reservations

Get all reservations for the current year:

```bash
npm run fetch
# Creates: output/reservations-YYYY.json
```

With custom date range:

```bash
npm run fetch -- --start-date 2026-01-01 --end-date 2026-12-31
```

### Export to CSV

Convert the most recent JSON file to CSV:

```bash
npm run csv
# Creates: output/reservations-YYYY.csv
```

Convert specific file:

```bash
npm run csv -- reservations-2026.json
```

### Generate iCal Calendar

Create calendar files for all reservations:

```bash
npm run ical
# Creates: output/reservations-YYYY.ics
```

This creates `.ics` files that can be:

- Imported to Google Calendar, Apple Calendar, Outlook
- Uploaded to S3 for automatic calendar syncing

See [docs/ICAL-SYNC.md](docs/ICAL-SYNC.md) for detailed setup instructions.

### Track Reservation Changes

Generate a per-year change report and append events to the global audit log:

```bash
npm run changes
# Creates:
# - output/audit/state-YYYY.json
# - output/audit/changes-YYYY.ndjson
# - output/audit/changes-YYYY.md
# - output/audit/reservation-changelog.ndjson
```

By default, removals are emitted after a reservation is missing in 2 consecutive runs.
If no audit state exists yet, the tracker will automatically bootstrap from
`reservations-b-YYYY.json` (if present) so first-run diffs can still be detected.

```bash
# Track against a specific file/year and custom missing threshold
npm run changes -- reservations-2026.json --year 2026 --missing-threshold 3

# Explicitly compare against a prior snapshot for first-run backfill
npm run changes -- reservations-2026.json --previous-file reservations-b-2026.json

# Re-run bootstrap comparison even if audit state already exists
npm run changes -- reservations-2026.json --previous-file reservations-b-2026.json --force-bootstrap --missing-threshold 1
```

### Analyze Data

View statistical analysis:

```bash
npm run analyze
# Reads from: output/reservations-YYYY.json
```

Shows breakdowns by status, booking source, month, and property.

## Command Line Options

| Option             | Description             | Default                   |
| ------------------ | ----------------------- | ------------------------- |
| `--start-date`     | Start date (YYYY-MM-DD) | Jan 1 of current year     |
| `--end-date`       | End date (YYYY-MM-DD)   | Dec 31 of current year    |
| `--output`         | Output filename         | `reservations-YYYY.json`  |
| `--domain`         | TrackHS domain prefix   | From `TRACKHS_DOMAIN` env |
| `--username`       | Login username          | -                         |
| `--password`       | Login password          | -                         |
| `--session-cookie` | Browser session cookie  | -                         |
| `--help, -h`       | Show help message       | -                         |

## Output Format

The script generates a JSON file containing an array of reservation objects. Each reservation includes:

```json
[
  {
    "id": 488410,
    "unitId": 186930,
    "arrivalDate": "2026-01-02",
    "departureDate": "2026-01-15",
    "nights": 13,
    "guestName": "John Doe",
    "totalAmount": 2500.00,
    "currency": "USD",
    "status": "confirmed",
    ...
  }
]
```

## How It Works

The script follows these steps:

1. **Authentication**:
   - Fetches the login page to extract CSRF security token
   - POSTs credentials with security token to establish session
   - Receives session cookie (`TrackOwner`)
2. **Token Retrieval**: Fetches a JWT token from `/owner/api-token/`
3. **Pagination**: Requests reservations page-by-page from `/api/v2/pms/reservations/`
4. **Aggregation**: Combines all pages into a single dataset
5. **Export**: Saves the complete dataset to a JSON file

## API Endpoints Discovered

Based on HAR file analysis:

- `GET /owner/` - Login page (contains CSRF security token)
- `POST /owner/` - Submit login credentials
  - Body parameters: `username`, `password`, `security` (CSRF token)
  - Success: 302 redirect to `/owner/dashboard/`
- `GET /owner/api-token/` - Retrieve JWT authentication token
- `GET /api/v2/pms/reservations/` - Fetch reservations (paginated)
  - Query parameters:
    - `startDateRange`: Filter by arrival date (start)
    - `endDateRange`: Filter by arrival date (end)
    - `unitId`: Filter by property unit
    - `search`: Text search
    - `page`: Page number
    - `size`: Results per page
    - `sortColumn`: Sort field
    - `sortDirection`: asc/desc

## Troubleshooting

### Authentication Failed

**Cause**: Invalid credentials or login issues.

**Solution**:

1. Verify your username and password are correct
2. Try logging in via the web interface to confirm credentials work
3. Check that your account has access to reservations
4. Ensure you're using the correct domain (check your TrackHS login URL)

### "Could not extract security token"

**Cause**: Unable to parse CSRF token from login page.

**Solution**:

1. The login page format may have changed
2. Try accessing https://YOUR-DOMAIN.trackhs.com/owner/ in a browser (replace YOUR-DOMAIN with your TrackHS subdomain)
3. The security token extraction patterns may need updating

### Using Session Cookie as Fallback

If username/password authentication isn't working, you can use a session cookie:

1. Log in to TrackHS in your browser
2. Open Developer Tools (F12)
3. Go to Application > Cookies
4. Find the `TrackOwner` cookie and copy its value
5. Use `--session-cookie "TrackOwner=your-cookie-value"`

### No Reservations Found

- Check your date range parameters
- Verify you have access to reservations in the TrackHS portal
- Try accessing the reservations page in your browser first

### Login Endpoint Not Working

The login flow wasn't captured in the HAR file, so the login endpoint is an educated guess. If it doesn't work:

1. Use the session cookie method instead
2. Capture a login HAR file to find the correct endpoint
3. Update the `login()` method in `src/fetch-reservations.js`

## Security Notes

- Never commit your `.env` file or expose session cookies
- Session cookies provide full account access - treat them like passwords
- Consider using environment variables instead of command-line arguments for credentials
- Tokens expire after 30 days (based on HAR data)

## Limitations

- This is a reverse-engineered API and may break if TrackHS updates their system
- Rate limiting is not implemented - use responsibly
- Some fields in the reservation data may not be fully documented
- The login flow may require adjustments based on your TrackHS configuration

## Legal & Ethical Use

This script is for personal use to access your own reservation data. Ensure you:

- Have proper authorization to access the TrackHS account
- Comply with TrackHS terms of service
- Don't abuse rate limits or cause service disruption
- Keep credentials and data secure

## License

MIT

## Contributing

Found an issue or improvement? Feel free to open an issue or submit a pull request.

## Changelog

### 1.0.0 (2026-01-27)

- Initial release
- Session cookie authentication
- Pagination support
- JSON export
- Summary statistics
