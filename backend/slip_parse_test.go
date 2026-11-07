package main

import (
	"context"
	"testing"
)

func TestParseSlip(t *testing.T) {
	cases := []struct {
		name string
		text string
		want SlipData
	}{
		{
			name: "K PLUS style: no labels, names in order sender then receiver",
			text: `โอนเงินสำเร็จ
6 พ.ย. 69 14:32 น.
นาย สมชาย ใจดี
ธ.กสิกรไทย
xxx-x-x1234-x
น.ส. สมหญิง รักดี
ธ.ไทยพาณิชย์
xxx-x-x5678-x
เลขที่รายการ:
015310143212ABC1234
จำนวน:
1,250.50 บาท
ค่าธรรมเนียม:
0.00 บาท`,
			want: SlipData{Date: "2026-11-06", Amount: 1250.50, FromName: "นาย สมชาย ใจดี",
				ToName: "น.ส. สมหญิง รักดี", Ref: "015310143212ABC1234", Bank: "กสิกรไทย (KBank)"},
		},
		{
			name: "SCB style: labelled จาก / ไปยัง, full Buddhist year",
			text: `SCB EASY
โอนเงินสำเร็จ
06 พ.ย. 2569 - 09:15
รหัสอ้างอิง: 202611061234567890
จาก นาย สมชาย ใจดี
xxx-xxx123-4
ไปยัง
ร้าน ข้าวมันไก่ป้าแดง
จำนวนเงิน 85.00
ค่าธรรมเนียม 0.00`,
			want: SlipData{Date: "2026-11-06", Amount: 85, FromName: "นาย สมชาย ใจดี",
				ToName: "ร้าน ข้าวมันไก่ป้าแดง", Ref: "202611061234567890", Bank: "ไทยพาณิชย์ (SCB)"},
		},
		{
			name: "English slip with From/To, Total line must not be taken as To",
			text: `Bangkok Bank Mobile Banking
Transfer successful
05 Nov 2026 18:01
From: MR SOMCHAI JAIDEE
To: MS SOMYING RAKDEE
Amount 12,000.00 THB
Fee 0.00 THB
Total 12,000.00 THB
Ref No. BBL20261105ABCD`,
			want: SlipData{Date: "2026-11-05", Amount: 12000, FromName: "MR SOMCHAI JAIDEE",
				ToName: "MS SOMYING RAKDEE", Ref: "BBL20261105ABCD", Bank: "กรุงเทพ (BBL)"},
		},
		{
			name: "OCR noise: spaced Thai letters, นิคหิต+สระอา instead of สระอำ",
			text: `Krungthai NEXT
3 ต . ค . 69
ผู้โอน นาย ทดสอบ ระบบ
ผู้รับ บจก. ตัวอย่าง
จ ํา น ว น เ งิ น
500.00 บาท`,
			want: SlipData{Date: "2026-10-03", Amount: 500, FromName: "นาย ทดสอบ ระบบ",
				ToName: "บจก. ตัวอย่าง", Bank: "กรุงไทย (KTB)"},
		},
		{
			// K PLUS bill payment as tesseract reads it (anonymised): พ.ย. came out as "พุย.", junk before the
			// names, and the receiver (a shop) has no title.
			name: "K PLUS payment to a shop, noisy OCR",
			text: `ชำระเงินสำเร็จ
๑ 5 พุย. 69 10:27 น.            I<+

) นาย สมชาย ใ
   4

ธ.กสิกรไทย

ง   %%%-%-%1234-%  ๐6

๓@   ร้านส้มตำ
009912345678901AbCD          .%E;

1009912345678901AbCD       ทก้า

จำนวน:
165.00um โซร
ค่าธรรมเนียม:      ผา
0.00 บาท
)        s
เลขที่รายการ:        สแกน

012345678901234567 ตรวจสอบสลิป`,
			want: SlipData{Date: "2026-11-05", Amount: 165, FromName: "นาย สมชาย ใ",
				ToName: "ร้านส้มตำ", Ref: "012345678901234567", Bank: "กสิกรไทย (KBank)"},
		},
		{
			name: "nothing readable",
			text: "????\n",
			want: SlipData{},
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := parseSlip(tc.text)
			if got != tc.want {
				t.Errorf("parseSlip()\n got: %+v\nwant: %+v", got, tc.want)
			}
		})
	}
}

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
	n, err := reparsePendingSlips(context.Background(), db)
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
	if n, _ := reparsePendingSlips(context.Background(), db); n != 0 {
		t.Fatalf("second run should change nothing, changed %d", n)
	}
}

func TestMakeDate(t *testing.T) {
	cases := []struct {
		d    string
		m    int
		y    string
		want string
	}{
		{"6", 11, "69", "2026-11-06"},
		{"6", 11, "2569", "2026-11-06"},
		{"6", 11, "2026", "2026-11-06"},
		{"6", 11, "26", "2026-11-06"},
		{"31", 2, "2569", ""}, // invalid day
		{"1", 13, "2569", ""}, // invalid month
	}
	for _, tc := range cases {
		if got := makeDate(tc.d, tc.m, tc.y); got != tc.want {
			t.Errorf("makeDate(%s,%d,%s) = %q, want %q", tc.d, tc.m, tc.y, got, tc.want)
		}
	}
}
