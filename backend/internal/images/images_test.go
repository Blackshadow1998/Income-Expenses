package images

import (
	"net/http/httptest"
	"testing"
)

func TestLinkIsValidOnlyForItsKindAndID(t *testing.T) {
	s := New(t.TempDir(), []byte("test-key"))
	link := s.Link("/api/slips/%d/image", "slip", 7)
	r := httptest.NewRequest("GET", link, nil)
	if !s.Valid(r, "slip", 7) {
		t.Fatalf("own link refused: %s", link)
	}
	if s.Valid(r, "trip", 7) || s.Valid(r, "slip", 8) {
		t.Fatal("link accepted for another kind or id")
	}
	if New("", []byte("other-key")).Valid(r, "slip", 7) {
		t.Fatal("link accepted with another key")
	}
}
