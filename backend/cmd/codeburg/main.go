package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/miguel/codeburg/internal/api"
	"github.com/miguel/codeburg/internal/db"
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
	// Initialize database
	database, err := db.Open(db.DefaultPath())
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()

	// Run migrations
	if err := database.Migrate(); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}

	// Create and start server
	server := api.NewServer(database)
	addr := fmt.Sprintf("%s:%d", host, port)
	log.Printf("Starting Codeburg server on %s", addr)
	if err := server.ListenAndServe(addr); err != nil {
		log.Fatalf("Server error: %v", err)
	}
}

func runMigrations() {
	database, err := db.Open(db.DefaultPath())
	if err != nil {
		log.Fatalf("Failed to open database: %v", err)
	}
	defer database.Close()

	if err := database.Migrate(); err != nil {
		log.Fatalf("Failed to run migrations: %v", err)
	}
	log.Println("Migrations completed successfully")
}
