# Rental Calendar Sync Docker Image
# Syncs rental property reservations to calendar with iCal, CSV, and JSON export

FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY src/ ./src/
COPY .env.template ./

# Create output directory
RUN mkdir -p /data

# Set environment variable for output directory
ENV OUTPUT_DIR=/data

# Default command shows help
CMD ["npm", "run", "help"]

# Labels for metadata
LABEL org.opencontainers.image.title="Rental Calendar Sync"
LABEL org.opencontainers.image.description="Sync rental property reservations to calendar with iCal, CSV, and JSON export"
LABEL org.opencontainers.image.authors="Jason Waters"
LABEL org.opencontainers.image.source="https://github.com/jasonwaters/rental-calendar-sync"
LABEL org.opencontainers.image.version="1.0.0"
