# Build context is the repository root (see docker-compose.yml).

# 1) Web app: static export of the Expo frontend, served by the API.
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npx expo export --platform web --output-dir dist

# 2) API
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/*.go ./
COPY backend/split/ ./split/
# modernc.org/sqlite is pure Go, so no CGO / C toolchain is needed.
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/api .

FROM alpine:3.20
# tesseract + Thai/English language data reads bank slips locally (no external service);
# imagemagick enlarges a slip for a second, sharper reading.
RUN apk add --no-cache tzdata tesseract-ocr tesseract-ocr-data-tha tesseract-ocr-data-eng imagemagick
ENV TZ=Asia/Bangkok OMP_THREAD_LIMIT=1
WORKDIR /app
COPY --from=build /out/api /app/api
COPY --from=web /web/dist /app/web
ENV DB_PATH=/app/data/income_expenses.db PORT=8080 WEB_DIR=/app/web
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["/app/api"]
