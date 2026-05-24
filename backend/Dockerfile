FROM golang:1.26-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME
RUN CGO_ENABLED=0 go build \
    -ldflags="-s -w \
              -X 'github.com/nikonok/expensesapp/backend/internal/version.Tag=${VERSION}' \
              -X 'github.com/nikonok/expensesapp/backend/internal/version.Commit=${COMMIT}' \
              -X 'github.com/nikonok/expensesapp/backend/internal/version.BuildTime=${BUILD_TIME}'" \
    -o /out/api ./cmd/api

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot
EXPOSE 8080
ENTRYPOINT ["/api"]
