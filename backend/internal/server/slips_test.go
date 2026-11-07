package server

import (
	"context"
	"testing"
)

func TestReparsePendingSlipsFillsMissingFields(t *testing.T) {
	_, db := newTestServer(t)
	text := "ชำระเงินสำเร็จ\n5 พุย. 69 10:27 น. K+\n) นาย สมชาย ใ\nธ.กสิกรไทย\nxxx-x-x1234-x\n๓@ ร้านส้มตำ\nจำนวน:\n165.00 บาท"
	// As saved by the old parser: amount read, date (upload day), names and bank missing; plus a
	// confirmed slip that must be left alone.
	if _, err := db.Exec(`INSERT INTO slips (user_id, image_file, file_hash, slip_date, date_found, amount_satang, ocr_text, status)
		VALUES (NULL, 'p.jpg', 'h1', '2026-11-07', 0, 16500, ?, 'pending'), (NULL, 'c.jpg', 'h2', '2026-11-07', 0, 0, ?, 'confirmed')`,
		text, text); err != nil {
		t.Fatal(err)
	}
	n, err := ReparsePendingSlips(context.Background(), db)
	if err != nil || n != 1 {
		t.Fatalf("reparse: %d %v", n, err)
	}
	var date, from, to string
	var found bool
	var bank *int64
	db.QueryRow(`SELECT slip_date, date_found, from_name, to_name, bank_id FROM slips WHERE file_hash = 'h1'`).Scan(&date, &found, &from, &to, &bank)
	if date != "2026-11-05" || !found || from != "นาย สมชาย ใ" || to != "ร้านส้มตำ" || bank == nil {
		t.Fatalf("pending slip after reparse: %s %v %q %q %v", date, found, from, to, bank)
	}
	db.QueryRow(`SELECT date_found FROM slips WHERE file_hash = 'h2'`).Scan(&found)
	if found {
		t.Fatal("confirmed slip must not be touched")
	}
	if n, _ := ReparsePendingSlips(context.Background(), db); n != 0 {
		t.Fatalf("second run should change nothing, changed %d", n)
	}
}
