package main

import (
	"fmt"
	"testing"
)

// Made-up convenience-store receipt shaped like a real OCR reading (anonymised, not real data).
const sampleReceipt = `SHOP CO.,LTD สาขาตัวอย่าง (00001)
TAX#0000000000000 (VAT Included)
ใบเสร็จรับเงิน/ใบกำกับภาษีอย่างย่อ
1 ถุงผ้า 0.00N
1 แซนด์วิชทูน่า 14.00
2 นมจืด กล่อง @12.00 24.00
1 ขนมปังไส้ครีม 8.00
3 น้ำดื่ม 600มล. e10.00 30.00
ยอดสุทธิ 7 ชิ้น 76.00
เงินสด/เงินทอน 100.00 24.00
R#0000000001 :1234567 07/09/66 18:39
แต้มสมาชิก +21 0 2022`

func TestParseReceipt(t *testing.T) {
	got := parseReceiptText(sampleReceipt)
	want := "[{แซนด์วิชทูน่า 14} {นมจืด กล่อง 24} {ขนมปังไส้ครีม 8} {น้ำดื่ม 600มล. 30}]"
	if fmt.Sprint(got.Items) != want {
		t.Fatalf("items = %v, want %v", got.Items, want)
	}
	if got.Amount != 76 || got.Date != "2023-09-07" {
		t.Fatalf("total %v date %q", got.Amount, got.Date)
	}

	// The enlarged reading wins when only its items add up to the total.
	broken := "1 แซนด์วิชทูน่า 14.00\nยอดสุทธิ 76.00"
	got = parseReceiptText(broken + "\n" + upscaledMark + "\n" + sampleReceipt)
	if len(got.Items) != 4 || got.Amount != 76 {
		t.Fatalf("merged = %+v", got)
	}

	// "รวม" inside an item name doesn't make it the total.
	got = parseReceiptText("ข้าวผัดรวมมิตร 60.00\nรวม 60.00")
	if len(got.Items) != 1 || got.Items[0].Name != "ข้าวผัดรวมมิตร" || got.Amount != 60 {
		t.Fatalf("รวม item = %+v", got)
	}
}
