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

# Empty data dir, created so the final image owns /var/lib/expensesapp as the
# nonroot user. When the (initially empty) apidata named volume is first
# mounted here, Docker seeds the mount's ownership from the image directory —
# so the nonroot process can create data.db instead of hitting SQLITE_CANTOPEN.
RUN mkdir -p /data

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
COPY --from=build --chown=nonroot:nonroot /data /var/lib/expensesapp
USER nonroot
EXPOSE 8080
ENTRYPOINT ["/api"]
