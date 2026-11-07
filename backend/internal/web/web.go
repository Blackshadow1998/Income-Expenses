// Package web serves the exported web app next to the API.
package web

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// Handler serves the exported web app (npx expo export -p web) next to the API, so the site works
// whenever the container runs. Existing files are served as-is; any other path gets index.html and
// the app's router takes over.
func Handler(dir string) http.Handler {
	files := http.FileServer(http.Dir(dir))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		p := path.Clean("/" + r.URL.Path)
		if info, err := os.Stat(filepath.Join(dir, filepath.FromSlash(p))); err == nil && !info.IsDir() {
			if strings.HasPrefix(p, "/_expo/static/") {
				// Bundles have a content hash in their name.
				w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
			} else {
				w.Header().Set("Cache-Control", "no-cache")
			}
			files.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-cache")
		http.ServeFile(w, r, filepath.Join(dir, "index.html"))
	})
}
