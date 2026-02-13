package api

import (
	"net/http/httptest"
	"testing"
)

func TestClientIP_DoesNotTrustForwardedHeadersFromDirectClient(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "203.0.113.10:41234"
	r.Header.Set("CF-Connecting-IP", "198.51.100.20")
	r.Header.Set("X-Forwarded-For", "198.51.100.30")

	if got := clientIP(r); got != "203.0.113.10" {
		t.Fatalf("expected remote addr IP, got %q", got)
	}
}

func TestClientIP_UsesCFConnectingIPWhenProxyTrusted(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "127.0.0.1:8080"
	r.Header.Set("CF-Connecting-IP", "198.51.100.42")

	if got := clientIP(r); got != "198.51.100.42" {
		t.Fatalf("expected CF-Connecting-IP, got %q", got)
	}
}

func TestClientIP_UsesFirstValidXFFWhenProxyTrusted(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "10.0.0.2:8080"
	r.Header.Set("X-Forwarded-For", "garbage, 198.51.100.77, 198.51.100.78")

	if got := clientIP(r); got != "198.51.100.77" {
		t.Fatalf("expected first valid X-Forwarded-For IP, got %q", got)
	}
}

func TestClientIP_ParsesIPv6RemoteAddr(t *testing.T) {
	r := httptest.NewRequest("GET", "/", nil)
	r.RemoteAddr = "[2001:db8::1]:443"

	if got := clientIP(r); got != "2001:db8::1" {
		t.Fatalf("expected IPv6 remote IP, got %q", got)
	}
}
