FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY *.go ./
# modernc.org/sqlite is pure Go, so no CGO / C toolchain is needed.
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/api .

FROM alpine:3.20
# tesseract + Thai/English language data reads bank slips locally (no external service).
RUN apk add --no-cache tzdata tesseract-ocr tesseract-ocr-data-tha tesseract-ocr-data-eng
ENV TZ=Asia/Bangkok OMP_THREAD_LIMIT=1
WORKDIR /app
COPY --from=build /out/api /app/api
ENV DB_PATH=/app/data/income_expenses.db PORT=8080
EXPOSE 8080
VOLUME ["/app/data"]
CMD ["/app/api"]
