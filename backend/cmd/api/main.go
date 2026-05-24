// Package main is the expensesapp backend API entrypoint.
package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/nikonok/expensesapp/backend/internal/account"
	"github.com/nikonok/expensesapp/backend/internal/admin"
	authpkg "github.com/nikonok/expensesapp/backend/internal/auth"
	"github.com/nikonok/expensesapp/backend/internal/config"
	"github.com/nikonok/expensesapp/backend/internal/db"
	"github.com/nikonok/expensesapp/backend/internal/family"
	"github.com/nikonok/expensesapp/backend/internal/jobs"
	"github.com/nikonok/expensesapp/backend/internal/live"
	internallog "github.com/nikonok/expensesapp/backend/internal/log"
	"github.com/nikonok/expensesapp/backend/internal/push"
	"github.com/nikonok/expensesapp/backend/internal/server"
	"github.com/nikonok/expensesapp/backend/internal/snapshot"
	syncp "github.com/nikonok/expensesapp/backend/internal/sync"
	"github.com/nikonok/expensesapp/backend/internal/version"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		slog.Error("failed to load config", "error", err)
		os.Exit(1)
	}

	logger := internallog.New(cfg.LogLevel)
	internallog.SetDefault(logger)

	database, err := db.Open(context.Background(), cfg.DBPath)
	if err != nil {
		slog.Error("db open failed", "err", err)
		os.Exit(1)
	}
	defer database.Close()
	slog.Info("db opened", "path", cfg.DBPath)

	if err := admin.EnsureBootstrap(context.Background(), database, cfg.BootstrapAdminEmail); err != nil {
		slog.Error("bootstrap failed", "err", err)
		os.Exit(1)
	}

	hub := live.NewHub()

	verifier := authpkg.NewGoogleVerifier(cfg.GoogleOAuthClientID)
	authH := authpkg.NewHandler(database, verifier)
	authH.SetHub(hub)
	reauthH := authpkg.NewReauthHandler(database, verifier)
	accountH := account.NewHandler(database)
	familyH := family.NewHandler(database)
	familyH.SetHub(hub)
	vapid := push.VAPIDConfig{
		PublicKey:  cfg.VAPIDPublicKey,
		PrivateKey: cfg.VAPIDPrivateKey,
		Subject:    cfg.VAPIDSubject,
	}
	qhSvc := push.NewQuietHoursService(database)
	deliverer := push.NewDeliverer(database, vapid, qhSvc)
	digestSvc := push.NewDigestService(database, deliverer)
	pushH := push.NewHandler(database, hub)

	syncH := syncp.NewHandler(database)
	eb := syncp.NewEventBus(hub)
	eb.SetPushDeliverer(digestSvc)
	syncH.SetEventBus(eb)
	liveH := live.NewHandler(hub)
	snapshotH := snapshot.NewHandler(database, hub)
	adminH := admin.NewHandler(database, hub)

	r := server.NewRouter(database, authH, reauthH, accountH, familyH, syncH, liveH, snapshotH, pushH, adminH, server.HealthConfig{Version: version.String()}, slog.Default())

	srv := &http.Server{
		Addr:    cfg.BindAddr,
		Handler: r,
	}

	// Start background job runner (non-blocking).
	runner := jobs.NewJobRunner(
		jobs.NewDailySnapshotJob(database),
		jobs.NewDigestPushJob(database, digestSvc, qhSvc),
		jobs.NewHeldDrainerJob(database, deliverer),
	)
	runner.Start(context.Background())

	// Graceful shutdown: listen for SIGTERM/SIGINT in background.
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		slog.Info("listening", "addr", cfg.BindAddr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("server error", "error", err)
			os.Exit(1)
		}
	}()

	<-quit
	slog.Info("shutting down")

	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	// Stop jobs before HTTP server so no new snapshots start during drain.
	runner.Stop()

	if err := srv.Shutdown(ctx); err != nil {
		slog.Error("shutdown error", "error", err)
		os.Exit(1)
	}
	slog.Info("stopped")
}

