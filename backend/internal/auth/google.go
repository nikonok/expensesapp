// Package auth verifies Google Sign-In ID tokens and manages sessions.
package auth

import (
	"context"
	"errors"
	"fmt"

	"google.golang.org/api/idtoken"
)

// Claims is the minimal extract we need from a Google ID token.
type Claims struct {
	Email         string
	EmailVerified bool
	Sub           string
	Name          string // "name" claim from the ID token; may be empty
}

// Verifier validates a Google ID token against the configured audience.
// Production uses GoogleVerifier; tests inject a mock.
type Verifier interface {
	Verify(ctx context.Context, idToken string) (*Claims, error)
}

// ErrInvalidIDToken is returned for any failure to validate the token.
// Handlers map this to HTTP 401.
var ErrInvalidIDToken = errors.New("invalid Google ID token")

// GoogleVerifier hits Google's JWKS via idtoken.Validate.
type GoogleVerifier struct {
	Audience string // GOOGLE_OAUTH_CLIENT_ID
}

func NewGoogleVerifier(audience string) *GoogleVerifier {
	return &GoogleVerifier{Audience: audience}
}

func (g *GoogleVerifier) Verify(ctx context.Context, idToken string) (*Claims, error) {
	if idToken == "" {
		return nil, ErrInvalidIDToken
	}
	payload, err := idtoken.Validate(ctx, idToken, g.Audience)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrInvalidIDToken, err)
	}
	email, _ := payload.Claims["email"].(string)
	emailVerified, _ := payload.Claims["email_verified"].(bool)
	sub := payload.Subject
	if email == "" || sub == "" || !emailVerified {
		return nil, ErrInvalidIDToken
	}
	name, _ := payload.Claims["name"].(string)
	return &Claims{Email: email, EmailVerified: emailVerified, Sub: sub, Name: name}, nil
}
