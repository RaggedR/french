FROM gcr.io/russian-transcription/russian-base:latest

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy application code
COPY . .

# Download OpenRussian dictionary CSVs (~21MB)
RUN node scripts/download-openrussian.js

# Cloud Run uses PORT env var
ENV PORT=8080
EXPOSE 8080

CMD ["node", "--import", "./instrument.mjs", "index.js"]
