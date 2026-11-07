package ocr

import (
	"regexp"
	"strings"
	"unicode"

	"income-expenses/internal/money"
)

// A shop receipt gives its line items and total, so a trip bill can be filled by tapping them.

type ReceiptItem struct {
	Name   string  `json:"name"`
	Amount float64 `json:"amount"`
}

// Receipt is what a receipt (or, with only Date and Amount, a payment slip) reads as.
type Receipt struct {
	Date   string        `json:"date"`   // YYYY-MM-DD, '' if not found
	Amount float64       `json:"amount"` // receipt total or slip amount, 0 if not found
	Items  []ReceiptItem `json:"items"`  // receipt lines with a price
}

var (
	// "[qty] name [@unit] price[flag]" — the flag is a VAT mark such as "N" or "V". Thermal prints
	// often read "14.00" as "14,00", so a comma before the last two digits counts as the decimal point.
	receiptLineRe = regexp.MustCompile(`^(?:(\d{1,3})\s+)?(.*?)\s*(\d{1,3}(?:,\d{3})+\.\d{2}|\d+[.,]\d{2})\s*[A-Za-z]?$`)
	trailingNumRe = regexp.MustCompile(`\s*\S*\d+[.,]\d{2}\s*$`) // a unit price ("@10.00") left in the name
)

func receiptAmount(s string) float64 {
	if i := len(s) - 3; i > 0 && s[i] == ',' {
		s = s[:i] + "." + s[i+1:]
	}
	return parseAmount(s)
}

// junkRunes counts characters in item names that are neither letters, marks, digits nor plain
// punctuation — what a garbled reading is full of.
func junkRunes(items []ReceiptItem) int {
	n := 0
	for _, it := range items {
		for _, r := range it.Name {
			if !unicode.IsLetter(r) && !unicode.IsMark(r) && !unicode.IsDigit(r) && !strings.ContainsRune(" .()/-%", r) {
				n++
			}
		}
	}
	return n
}

// receiptSkip marks lines that carry a price but aren't items: payment, change, tax, points.
var receiptSkip = []string{"เงินสด", "ทอน", "cash", "change", "vat", "ภาษี", "tax", "แต้ม", "คงเหลือ", "ได้รับ",
	"ใช้ไป", "ส่วนลด", "discount", "บัตร", "card", "พร้อมเพย์", "promptpay", "qr", "ชำระ", "paid"}

// isTotalLine marks the total line; the last one wins (a grand total follows the subtotal). "รวม" and
// "net" count only at the start, so items like "ข้าวผัดรวมมิตร" stay items.
func isTotalLine(key string) bool {
	return containsAny(key, []string{"สุทธิ", "ยอดรวม", "total", "amountdue"}) ||
		strings.HasPrefix(key, "รวม") || strings.HasPrefix(key, "net")
}

func containsAny(s string, words []string) bool {
	for _, w := range words {
		if strings.Contains(s, w) {
			return true
		}
	}
	return false
}

// parseReceiptPart reads one OCR reading of a receipt.
func parseReceiptPart(text string) Receipt {
	res := Receipt{Items: []ReceiptItem{}}
	lines := NormalizeLines(text)
	for _, l := range lines {
		key := Compact(l)
		if isTotalLine(key) {
			if m := receiptLineRe.FindStringSubmatch(l); m != nil && !containsAny(key, []string{"เงินสด", "ทอน", "cash", "change"}) {
				res.Amount = receiptAmount(m[3])
			}
			continue
		}
		if containsAny(key, receiptSkip) {
			continue
		}
		m := receiptLineRe.FindStringSubmatch(l)
		if m == nil {
			continue
		}
		name := strings.TrimSpace(trailingNumRe.ReplaceAllString(m[2], ""))
		name = strings.TrimLeft(strings.Trim(name, " |:-_*#'\""), ".") // keep a trailing "มล."
		amount := receiptAmount(m[3])
		if amount <= 0 || LetterCount(name) < 2 {
			continue
		}
		res.Items = append(res.Items, ReceiptItem{Name: name, Amount: amount})
	}
	res.Date = findDate(lines)
	return res
}

// ParseReceiptText parses stored OCR text (original reading, optionally + the enlarged one) and keeps
// the reading whose items add up to the total, else the one with more items, else the cleaner one.
func ParseReceiptText(text string) Receipt {
	orig, big, ok := strings.Cut(text, "\n"+UpscaledMark+"\n")
	a := parseReceiptPart(orig)
	if !ok {
		return a
	}
	b := parseReceiptPart(big)
	adds := func(r Receipt) bool {
		var sum int64
		for _, it := range r.Items {
			sum += money.ToSatang(it.Amount)
		}
		return r.Amount > 0 && sum == money.ToSatang(r.Amount)
	}
	better := func(x, y Receipt) bool {
		if adds(x) != adds(y) {
			return adds(x)
		}
		if len(x.Items) != len(y.Items) {
			return len(x.Items) > len(y.Items)
		}
		return junkRunes(x.Items) < junkRunes(y.Items)
	}
	best, other := a, b
	if better(b, a) {
		best, other = b, a
	}
	if best.Amount == 0 {
		best.Amount = other.Amount
	}
	if best.Date == "" {
		best.Date = other.Date
	}
	return best
}
