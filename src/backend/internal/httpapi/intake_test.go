// Contract test for the drop intake classification route.
package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"rperedux/server/internal/intake"
)

func TestIntakeClassifyRouteReportsChartExtensionAndSkin(t *testing.T) {
	data := testStore(t)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	root := t.TempDir()
	chart := filepath.Join(root, "chart.json")
	if err := os.WriteFile(chart, []byte(`{"META":{"name":"Route Song"},"BPMList":[]}`), 0o644); err != nil {
		t.Fatal(err)
	}
	extension := filepath.Join(root, "extension")
	if err := os.MkdirAll(extension, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(extension, "manifest.json"),
		[]byte(`{"id":"demo.route","name":"Route Extension"}`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	skin := filepath.Join(root, "skin")
	if err := os.MkdirAll(skin, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(skin, "info.yml"), []byte("name: Route Skin\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	body := fmt.Sprintf(`{"paths":[%q,%q,%q,%q]}`, chart, extension, skin, filepath.Join(root, "missing"))
	request, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/intake/classify",
		bytes.NewBufferString(body),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Redux-Client", "1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	items := decodeAPI[[]intake.Item](t, response, "items")
	if len(items) != 4 {
		t.Fatalf("items = %#v", items)
	}
	if items[0].Kind != intake.KindChart || items[0].Format != intake.FormatRPE || items[0].Name != "Route Song" {
		t.Fatalf("chart = %#v", items[0])
	}
	if items[1].Kind != intake.KindExtension || items[1].PackageID != "demo.route" {
		t.Fatalf("Extension = %#v", items[1])
	}
	if items[2].Kind != intake.KindSkin || items[2].Name != "Route Skin" {
		t.Fatalf("skin = %#v", items[2])
	}
	if items[3].Kind != intake.KindUnknown {
		t.Fatalf("unknown = %#v", items[3])
	}
}

func TestIntakeClassifyRouteRejectsAnOversizedDrop(t *testing.T) {
	data := testStore(t)
	server := httptest.NewServer(NewAPI(data))
	defer server.Close()

	paths := make([]string, maxIntakePaths+1)
	body, err := json.Marshal(map[string]any{"paths": paths})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(
		http.MethodPost,
		server.URL+"/api/intake/classify",
		bytes.NewReader(body),
	)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Redux-Client", "1")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusBadRequest {
		t.Fatalf("oversized route status = %d, want 400", response.StatusCode)
	}
}
