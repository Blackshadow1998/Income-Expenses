package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"mime/multipart"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

// putImage uploads a small PNG as multipart field `field` with PUT.
func putImage(t *testing.T, c testClient, token, path, field string) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	fw, _ := mw.CreateFormFile(field, "image.png")
	_ = png.Encode(fw, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	mw.Close()
	req, _ := http.NewRequest("PUT", c.srv.URL+path, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

// postPayment sends a multipart payment, optionally with a small PNG as the slip.
func postPayment(t *testing.T, c testClient, token string, tripID int64, fields map[string]string, withSlip bool) (int, map[string]any) {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	for k, v := range fields {
		_ = mw.WriteField(k, v)
	}
	if withSlip {
		fw, _ := mw.CreateFormFile("slip", "slip.png")
		_ = png.Encode(fw, image.NewRGBA(image.Rect(0, 0, 4, 4)))
	}
	mw.Close()
	req, _ := http.NewRequest("POST", fmt.Sprintf("%s/api/trips/%d/payments", c.srv.URL, tripID), &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	req.Header.Set("Authorization", "Bearer "+token)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	out := map[string]any{}
	_ = json.NewDecoder(res.Body).Decode(&out)
	return res.StatusCode, out
}

func TestTripSplitAPI(t *testing.T) {
	var dir string
	c, _ := newTestServer(t, func(a *API) { dir = a.slipsDir })
	owner := c.signedIn("owner")

	status, trip := c.do("POST", "/api/trips", owner, map[string]any{"name": "เที่ยวเชียงใหม่", "members": []string{"A", "B", "C", "D", "E", "A"}})
	if status != http.StatusCreated {
		t.Fatalf("create trip: %d %v", status, trip)
	}
	tripID := int64(trip["id"].(float64))
	ids := map[string]int64{}
	for _, m := range trip["members"].([]any) {
		m := m.(map[string]any)
		ids[m["name"].(string)] = int64(m["id"].(float64))
	}
	if len(ids) != 5 {
		t.Fatalf("members: %v", trip["members"])
	}
	parts := func(names ...string) []map[string]any {
		out := []map[string]any{}
		for _, n := range names {
			out = append(out, map[string]any{"member_id": ids[n]})
		}
		return out
	}
	base := fmt.Sprintf("/api/trips/%d", tripID)
	for _, b := range []map[string]any{
		{"title": "ที่พัก", "amount": 500, "payer_id": ids["A"], "date": "2026-11-01", "parts": parts("A", "B", "C", "D")},
		{"title": "ค่ารถ", "amount": 1000, "payer_id": ids["B"], "date": "2026-11-02", "parts": parts("A", "B", "D")},
		{"title": "ข้าวเย็น", "amount": 400, "payer_id": ids["A"], "date": "2026-11-02", "parts": parts("A", "D", "E")},
	} {
		if status, out := c.do("POST", base+"/bills", owner, b); status != http.StatusCreated {
			t.Fatalf("bill %v: %d %v", b["title"], status, out)
		}
	}

	// Unequal split that doesn't add up is refused; one that does is accepted and can be edited away.
	bad := map[string]any{"title": "x", "amount": 100, "payer_id": ids["A"], "date": "2026-11-03", "split_mode": "amount",
		"parts": []map[string]any{{"member_id": ids["A"], "value": 30}, {"member_id": ids["B"], "value": 60}}}
	if status, out := c.do("POST", base+"/bills", owner, bad); status != http.StatusBadRequest {
		t.Fatalf("amounts not adding up: %d %v", status, out)
	}
	bad["parts"] = []map[string]any{{"member_id": ids["A"], "value": 40}, {"member_id": ids["B"], "value": 60}}
	status, out := c.do("POST", base+"/bills", owner, bad)
	if status != http.StatusCreated {
		t.Fatalf("unequal bill: %d %v", status, out)
	}
	var extra float64
	for _, b := range out["bills"].([]any) {
		if b.(map[string]any)["title"] == "x" {
			extra = b.(map[string]any)["id"].(float64)
		}
	}
	// A bill photo: attach, open by its signed link, replace, remove; deleting the bill removes it.
	billImg := fmt.Sprintf("/api/bills/%.0f/image", extra)
	imageOf := func(out map[string]any) string {
		for _, b := range out["bills"].([]any) {
			if b.(map[string]any)["id"] == extra {
				return b.(map[string]any)["image_url"].(string)
			}
		}
		return "?"
	}
	status, out = putImage(t, c, owner, billImg, "image")
	if status != http.StatusOK || imageOf(out) == "" {
		t.Fatalf("bill image: %d %v", status, out)
	}
	files := func() int {
		m, _ := filepath.Glob(filepath.Join(dir, "trip-*"))
		return len(m)
	}
	res, err := http.Get(c.srv.URL + imageOf(out))
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("open bill image: %v %v", err, res)
	}
	res.Body.Close()
	if res, _ := http.Get(c.srv.URL + strings.NewReplacer("trip-bills", "trip-payments", "/image", "/slip").Replace(imageOf(out))); res.StatusCode != http.StatusForbidden {
		t.Fatalf("bill link opened as a payment slip: %d", res.StatusCode)
	}
	if status, _ := putImage(t, c, c.signedIn("stranger"), billImg, "image"); status != http.StatusNotFound {
		t.Fatalf("other user's bill image: %d", status)
	}
	if status, out = c.do("DELETE", billImg, owner, nil); status != http.StatusOK || imageOf(out) != "" || files() != 0 {
		t.Fatalf("remove bill image: %d %v", status, out)
	}
	putImage(t, c, owner, billImg, "image")
	if status, _ := c.do("DELETE", fmt.Sprintf("/api/bills/%.0f", extra), owner, nil); status != http.StatusOK {
		t.Fatalf("delete bill: %d", status)
	}

	pairText := func(mode string) (map[string]float64, map[string]any) {
		_, s := c.do("GET", base+"/summary?mode="+mode, owner, nil)
		got := map[string]float64{}
		key := "pairs"
		if mode == "minimal" {
			key = "transfers"
		}
		for _, p := range s[key].([]any) {
			p := p.(map[string]any)
			got[p["from_name"].(string)+">"+p["to_name"].(string)] = p["remaining"].(float64)
		}
		return got, s
	}
	pairs, s := pairText("pairwise")
	want := map[string]float64{"A>B": 208.33, "C>A": 125, "D>A": 258.33, "D>B": 333.33, "E>A": 133.33}
	if fmt.Sprint(pairs) != fmt.Sprint(want) {
		t.Fatalf("pairwise = %v, want %v", pairs, want)
	}
	nets := map[string]float64{}
	for _, p := range s["people"].([]any) {
		p := p.(map[string]any)
		nets[p["name"].(string)] = p["net"].(float64)
	}
	if fmt.Sprint(nets) != fmt.Sprint(map[string]float64{"A": 308.33, "B": 541.66, "C": -125, "D": -591.66, "E": -133.33}) {
		t.Fatalf("nets = %v", nets)
	}
	if minimal, _ := pairText("minimal"); len(minimal) != 4 || minimal["D>B"] != 541.66 {
		t.Fatalf("minimal = %v", minimal)
	}

	// D pays A part of 258.33 with a slip: partial, then confirmed, then deleted.
	status, out = postPayment(t, c, owner, tripID, map[string]string{
		"from_member": fmt.Sprint(ids["D"]), "to_member": fmt.Sprint(ids["A"]), "amount": "100", "date": "2026-11-05", "note": "โอนก่อน",
	}, true)
	if status != http.StatusCreated {
		t.Fatalf("payment: %d %v", status, out)
	}
	pay := out["payments"].([]any)[0].(map[string]any)
	if pay["slip_url"] == "" || pay["confirmed"] != false {
		t.Fatalf("payment: %v", pay)
	}
	res, err = http.Get(c.srv.URL + pay["slip_url"].(string))
	if err != nil || res.StatusCode != http.StatusOK {
		t.Fatalf("slip image: %v %v", err, res)
	}
	res.Body.Close()
	_, s = c.do("GET", base+"/summary", owner, nil)
	for _, p := range s["pairs"].([]any) {
		p := p.(map[string]any)
		if p["from_name"] == "D" && p["to_name"] == "A" && (p["status"] != "partial" || p["remaining"] != 158.33) {
			t.Fatalf("D>A after paying 100: %v", p)
		}
	}
	payPath := fmt.Sprintf("/api/payments/%.0f", pay["id"].(float64))
	if status, out := c.do("PATCH", payPath, owner, map[string]any{"confirmed": true}); status != http.StatusOK ||
		out["payments"].([]any)[0].(map[string]any)["confirmed"] != true {
		t.Fatalf("confirm: %d %v", status, out)
	}
	if status, _ := postPayment(t, c, owner, tripID, map[string]string{
		"from_member": fmt.Sprint(ids["D"]), "to_member": fmt.Sprint(ids["D"]), "amount": "1", "date": "2026-11-05"}, false); status != http.StatusBadRequest {
		t.Fatalf("paying oneself: %d", status)
	}
	// The slip can be removed and attached again later (replacing doesn't leave the old file behind).
	if status, out := c.do("DELETE", payPath+"/slip", owner, nil); status != http.StatusOK ||
		out["payments"].([]any)[0].(map[string]any)["slip_url"] != "" || files() != 0 {
		t.Fatalf("remove slip: %d %v", status, out)
	}
	putImage(t, c, owner, payPath+"/slip", "slip")
	if status, out := putImage(t, c, owner, payPath+"/slip", "slip"); status != http.StatusOK ||
		out["payments"].([]any)[0].(map[string]any)["slip_url"] == "" || files() != 1 {
		t.Fatalf("replace slip: %d %v (files %d)", status, out, files())
	}
	if status, _ := c.do("DELETE", payPath, owner, nil); status != http.StatusOK || files() != 0 {
		t.Fatalf("delete payment: %d", status)
	}
	if pairs, _ := pairText("pairwise"); pairs["D>A"] != 258.33 {
		t.Fatalf("after deleting the payment: %v", pairs)
	}

	// Members with bills can't be removed; a new, unused one can.
	if status, _ := c.do("DELETE", fmt.Sprintf("%s/members/%d", base, ids["C"]), owner, nil); status != http.StatusConflict {
		t.Fatalf("removing a member with bills: %d", status)
	}
	_, out = c.do("POST", base+"/members", owner, map[string]string{"name": "F"})
	if status, _ := c.do("POST", base+"/members", owner, map[string]string{"name": "F"}); status != http.StatusConflict {
		t.Fatalf("duplicate member: %d", status)
	}
	members := out["members"].([]any)
	f := members[len(members)-1].(map[string]any)
	if status, _ := c.do("DELETE", fmt.Sprintf("%s/members/%.0f", base, f["id"].(float64)), owner, nil); status != http.StatusOK {
		t.Fatalf("removing an unused member: %d", status)
	}

	// Another user sees nothing of it.
	other := c.signedIn("other")
	var trips []any
	c.doInto("GET", "/api/trips", other, nil, &trips)
	if len(trips) != 0 {
		t.Fatalf("other user sees trips: %v", trips)
	}
	if status, _ := c.do("GET", base+"/summary", other, nil); status != http.StatusNotFound {
		t.Fatalf("other user summary: %d", status)
	}
	if status, _ := c.do("DELETE", base, other, nil); status != http.StatusNotFound {
		t.Fatalf("other user delete: %d", status)
	}
	if status, _ := c.do("DELETE", base, owner, nil); status != http.StatusNoContent {
		t.Fatalf("delete trip: %d", status)
	}
}
