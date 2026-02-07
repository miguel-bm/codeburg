package main

import (
	"flag"
	"fmt"
	"log/slog"
	"os"

	"github.com/miguel-bm/codeburg/internal/api"
	"github.com/miguel-bm/codeburg/internal/db"
)

func main() {
	serveCmd := flag.NewFlagSet("serve", flag.ExitOnError)
	serveHost := serveCmd.String("host", "0.0.0.0", "Host to bind to")
	servePort := serveCmd.Int("port", 8080, "Port to listen on")

	if len(os.Args) < 2 {
		fmt.Println("Usage: codeburg <command> [options]")
		fmt.Println()
		fmt.Println("Commands:")
		fmt.Println("  serve    Start the Codeburg server")
		fmt.Println("  migrate  Run database migrations")
		os.Exit(1)
	}

	switch os.Args[1] {
	case "serve":
		serveCmd.Parse(os.Args[2:])
		runServer(*serveHost, *servePort)

	case "migrate":
		runMigrations()

	default:
		fmt.Printf("Unknown command: %s\n", os.Args[1])
		os.Exit(1)
	}
}

func runServer(host string, port int) {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})))

	// Initialize database
	database, err := db.Open(db.DefaultPath())
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	// Run migrations
	if err := database.Migrate(); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}

	// Create and start server
	server := api.NewServer(database)
	addr := fmt.Sprintf("%s:%d", host, port)
	slog.Info("starting codeburg server", "addr", addr)
	if err := server.ListenAndServe(addr); err != nil {
		slog.Error("server error", "error", err)
		os.Exit(1)
	}
}

func runMigrations() {
	slog.SetDefault(slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelDebug})))

	database, err := db.Open(db.DefaultPath())
	if err != nil {
		slog.Error("failed to open database", "error", err)
		os.Exit(1)
	}
	defer database.Close()

	if err := database.Migrate(); err != nil {
		slog.Error("failed to run migrations", "error", err)
		os.Exit(1)
	}
	slog.Info("migrations completed successfully")
}
