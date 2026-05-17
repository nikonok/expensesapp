package auth

import (
	"context"
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeVerifier is a test double for Verifier.
// If err is set it is returned; otherwise claims is returned.
type fakeVerifier struct {
	claims *Claims
	err    error
}

func (f *fakeVerifier) Verify(_ context.Context, _ string) (*Claims, error) {
	if f.err != nil {
		return nil, f.err
	}
	return f.claims, nil
}

func TestGoogleVerifier_EmptyToken(t *testing.T) {
	v := NewGoogleVerifier("test-audience")
	claims, err := v.Verify(context.Background(), "")
	assert.Nil(t, claims)
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrInvalidIDToken), "expected ErrInvalidIDToken, got: %v", err)
}

func TestFakeVerifier_EmptyEmail(t *testing.T) {
	v := &fakeVerifier{err: ErrInvalidIDToken}
	claims, err := v.Verify(context.Background(), "some-token")
	assert.Nil(t, claims)
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrInvalidIDToken))
}

func TestFakeVerifier_UnverifiedEmail(t *testing.T) {
	v := &fakeVerifier{err: ErrInvalidIDToken}
	claims, err := v.Verify(context.Background(), "some-token")
	assert.Nil(t, claims)
	require.Error(t, err)
	assert.True(t, errors.Is(err, ErrInvalidIDToken))
}

func TestFakeVerifier_ValidClaims(t *testing.T) {
	want := &Claims{
		Email:         "user@example.com",
		EmailVerified: true,
		Sub:           "1234567890",
	}
	v := &fakeVerifier{claims: want}
	got, err := v.Verify(context.Background(), "valid-token")
	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, want.Email, got.Email)
	assert.Equal(t, want.EmailVerified, got.EmailVerified)
	assert.Equal(t, want.Sub, got.Sub)
}
