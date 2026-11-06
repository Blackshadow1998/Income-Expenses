package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// SlipData is what we could read from a bank transfer slip. Empty/zero fields were not found.
type SlipData struct {
	Date     string  // YYYY-MM-DD
	Amount   float64 // baht
	FromName string  // sender account name
	ToName   string  // receiver account name
	Ref      string  // transaction reference number
	Bank     string  // sender bank, matching banks.name
}

// runOCR reads text from an image with tesseract (Thai + English).
func runOCR(ctx context.Context, imagePath string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "tesseract", imagePath, "stdout",
		"-l", "tha+eng", "--psm", "4", "-c", "preserve_interword_spaces=1")
	cmd.Dir = os.TempDir() // tesseract may drop a profiling file in the working dir
	out, err := cmd.Output()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return "", fmt.Errorf("tesseract: %v: %s", err, strings.TrimSpace(string(ee.Stderr)))
		}
		return "", fmt.Errorf("tesseract: %w", err)
	}
	return string(out), nil
}

var (
	amountRe   = regexp.MustCompile(`\d{1,3}(?:,\d{3})+\.\d{2}|\d+\.\d{2}`)
	numDateRe  = regexp.MustCompile(`(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4}|\d{2})(?:\D|$)`)
	refRe      = regexp.MustCompile(`[A-Za-z0-9]{8,}`)
	spacesRe   = regexp.MustCompile(`\s+`)
	thMonthRe  *regexp.Regexp
	enMonthRe  = regexp.MustCompile(`(?i)(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s*(\d{4}|\d{2})(?:\D|$)`)
	thMonthIdx = map[string]int{}
	enMonthIdx = map[string]int{"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12}
)

func init() {
	full := []string{"มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
		"กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"}
	short := []string{"มค", "กพ", "มีค", "เมย", "พค", "มิย", "กค", "สค", "กย", "ตค", "พย", "ธค"}
	var alts []string
	for i := range full {
		thMonthIdx[full[i]] = i + 1
		thMonthIdx[short[i]] = i + 1
		alts = append(alts, looseThai(full[i]))
	}
	for i := range short {
		alts = append(alts, looseThai(short[i]))
	}
	// Day, month (full names first so they win over abbreviations), year.
	// Dots are stripped before matching; OCR may add spaces between Thai letters.
	thMonthRe = regexp.MustCompile(`(\d{1,2})\s*(` + strings.Join(alts, "|") + `)\s*(\d{4}|\d{2})(?:\D|$)`)
}

// looseThai allows optional whitespace between every rune.
func looseThai(s string) string {
	var parts []string
	for _, r := range s {
		parts = append(parts, regexp.QuoteMeta(string(r)))
	}
	return strings.Join(parts, `\s*`)
}

// normalizeOCR fixes common Thai OCR artifacts and splits into trimmed, non-empty lines.
func normalizeOCR(text string) []string {
	text = strings.ReplaceAll(text, "\r", "")
	text = strings.ReplaceAll(text, "ํา", "ำ") // นิคหิต+สระอา -> สระอำ
	var lines []string
	for _, l := range strings.Split(text, "\n") {
		l = strings.TrimSpace(spacesRe.ReplaceAllString(l, " "))
		if l != "" {
			lines = append(lines, l)
		}
	}
	return lines
}

// compact removes spaces, dots and colons and lowercases, for keyword matching.
func compact(s string) string {
	s = strings.ToLower(s)
	return strings.NewReplacer(" ", "", ".", "", ":", "", "​", "").Replace(s)
}

func parseSlip(text string) SlipData {
	lines := normalizeOCR(text)
	keys := make([]string, len(lines))
	for i, l := range lines {
		keys[i] = compact(l)
	}
	return SlipData{
		Date:     findDate(lines),
		Amount:   findAmount(lines, keys),
		FromName: findLabeled(lines, keys, []string{"จาก", "ผู้โอน", "from"}),
		ToName:   findLabeled(lines, keys, []string{"ไปยัง", "ไปที่", "ถึง", "ผู้รับ", "to"}),
		Ref:      findRef(lines, keys),
		Bank:     findBank(strings.Join(keys, "\n")),
	}.withNameFallback(lines, keys)
}

func isFeeLine(key string) bool {
	return strings.Contains(key, "ค่าธรรมเนียม") || strings.Contains(key, "fee") || strings.Contains(key, "คงเหลือ") ||
		strings.Contains(key, "balance")
}

func parseAmount(s string) float64 {
	v, _ := strconv.ParseFloat(strings.ReplaceAll(s, ",", ""), 64)
	return v
}

// findAmount prefers a number on (or right after) an "จำนวน/amount" line, then one next to
// "บาท/THB", then the largest money-looking number. Fee and remaining-balance lines are skipped.
func findAmount(lines, keys []string) float64 {
	for i, k := range keys {
		if isFeeLine(k) || !(strings.Contains(k, "จำนวน") || strings.Contains(k, "amount")) {
			continue
		}
		for j := i; j < len(lines) && j <= i+1; j++ {
			if j > i && isFeeLine(keys[j]) {
				break
			}
			if m := amountRe.FindString(lines[j]); m != "" {
				return parseAmount(m)
			}
		}
	}
	for i, k := range keys {
		if isFeeLine(k) || !(strings.Contains(k, "บาท") || strings.Contains(k, "thb") || strings.Contains(k, "฿")) {
			continue
		}
		if m := amountRe.FindString(lines[i]); m != "" && parseAmount(m) > 0 {
			return parseAmount(m)
		}
	}
	var best float64
	for i, k := range keys {
		if isFeeLine(k) {
			continue
		}
		for _, m := range amountRe.FindAllString(lines[i], -1) {
			if v := parseAmount(m); v > best {
				best = v
			}
		}
	}
	return best
}

func findDate(lines []string) string {
	for _, l := range lines {
		noDots := strings.ReplaceAll(l, ".", "")
		if m := thMonthRe.FindStringSubmatch(noDots); m != nil {
			if d := makeDate(m[1], thMonthIdx[spacesRe.ReplaceAllString(m[2], "")], m[3]); d != "" {
				return d
			}
		}
		if m := enMonthRe.FindStringSubmatch(l); m != nil {
			if d := makeDate(m[1], enMonthIdx[strings.ToLower(m[2][:3])], m[3]); d != "" {
				return d
			}
		}
		if m := numDateRe.FindStringSubmatch(l); m != nil {
			mon, _ := strconv.Atoi(m[2])
			if d := makeDate(m[1], mon, m[3]); d != "" {
				return d
			}
		}
	}
	return ""
}

// makeDate turns day/month/year (2- or 4-digit, Buddhist or Christian era) into YYYY-MM-DD.
func makeDate(dayS string, month int, yearS string) string {
	day, _ := strconv.Atoi(dayS)
	year, _ := strconv.Atoi(yearS)
	switch {
	case year >= 2400: // พ.ศ.
		year -= 543
	case year >= 50 && year < 100: // พ.ศ. 2 หลัก เช่น 69 = 2569
		year = 2500 + year - 543
	case year < 50: // ค.ศ. 2 หลัก เช่น 26 = 2026
		year += 2000
	}
	t := time.Date(year, time.Month(month), day, 0, 0, 0, 0, time.Local)
	if month < 1 || month > 12 || t.Day() != day || year < 2000 || year > 2100 {
		return ""
	}
	return t.Format("2006-01-02")
}

// findLabeled returns the value after a label like "จาก:" — on the same line, or the next line.
func findLabeled(lines, keys []string, labels []string) string {
	for i, k := range keys {
		for _, label := range labels {
			if !strings.HasPrefix(k, label) {
				continue
			}
			// "to"/"from" must be a whole word in the original line, not "total"/"tomorrow".
			if isASCII(label) {
				orig := strings.ToLower(strings.TrimSpace(lines[i]))
				if !strings.HasPrefix(orig, label) || (len(orig) > len(label) && isLetter(orig[len(label)])) {
					continue
				}
			}
			if rest := cleanName(stripLabel(lines[i], label)); rest != "" {
				return rest
			}
			if i+1 < len(lines) {
				return cleanName(lines[i+1])
			}
		}
	}
	return ""
}

// stripLabel removes the label (matched loosely, OCR may space Thai letters) from the start of the line.
func stripLabel(line, label string) string {
	re := regexp.MustCompile(`(?i)^\s*` + looseThai(label) + `\s*[:：]?\s*`)
	return re.ReplaceAllString(line, "")
}

var namePrefixes = []string{"นาย", "นางสาว", "นาง", "นส", "ดช", "ดญ", "คุณ", "mr", "mrs", "ms", "miss",
	"บจก", "บริษัท", "หจก", "ร้าน", "บมจ", "co", "company"}

// withNameFallback fills missing names from lines that start with a personal/company title:
// on Thai slips the sender is listed first and the receiver second.
func (d SlipData) withNameFallback(lines, keys []string) SlipData {
	if d.FromName != "" && d.ToName != "" {
		return d
	}
	var names []string
	for i, k := range keys {
		for _, p := range namePrefixes {
			if strings.HasPrefix(k, p) && digitRatio(k) < 0.3 {
				names = append(names, cleanName(lines[i]))
				break
			}
		}
	}
	for _, n := range names {
		switch {
		case d.FromName == "" && n != d.ToName:
			d.FromName = n
		case d.ToName == "" && n != d.FromName:
			d.ToName = n
		}
	}
	return d
}

func findRef(lines, keys []string) string {
	labels := []string{"เลขที่รายการ", "รหัสอ้างอิง", "หมายเลขอ้างอิง", "เลขที่อ้างอิง", "ref", "transactionid", "transactionno"}
	for i, k := range keys {
		for _, label := range labels {
			if !strings.Contains(k, label) {
				continue
			}
			for j := i; j < len(lines) && j <= i+1; j++ {
				if m := refRe.FindString(strings.ReplaceAll(lines[j], " ", "")); m != "" {
					return m
				}
			}
		}
	}
	return ""
}

// bankKeywords map OCR keywords (compact, lowercase) to names in the banks table.
var bankKeywords = []struct{ key, bank string }{
	{"k+", "กสิกรไทย (KBank)"}, {"kplus", "กสิกรไทย (KBank)"}, {"kbank", "กสิกรไทย (KBank)"},
	{"kasikorn", "กสิกรไทย (KBank)"}, {"กสิกร", "กสิกรไทย (KBank)"},
	{"scb", "ไทยพาณิชย์ (SCB)"}, {"ไทยพาณิชย์", "ไทยพาณิชย์ (SCB)"},
	{"bangkokbank", "กรุงเทพ (BBL)"}, {"bualuang", "กรุงเทพ (BBL)"}, {"บัวหลวง", "กรุงเทพ (BBL)"}, {"ธกรุงเทพ", "กรุงเทพ (BBL)"},
	{"krungthai", "กรุงไทย (KTB)"}, {"กรุงไทย", "กรุงไทย (KTB)"}, {"paotang", "กรุงไทย (KTB)"}, {"เป๋าตัง", "กรุงไทย (KTB)"},
	{"krungsri", "กรุงศรีอยุธยา (Krungsri)"}, {"กรุงศรี", "กรุงศรีอยุธยา (Krungsri)"},
	{"ttb", "ทหารไทยธนชาต (ttb)"}, {"ทหารไทย", "ทหารไทยธนชาต (ttb)"},
	{"mymo", "ออมสิน (GSB)"}, {"ออมสิน", "ออมสิน (GSB)"},
	// not "ธกส": "ธ.กสิกรไทย" compacts to "ธกสิกรไทย".
	{"baac", "ธ.ก.ส. (BAAC)"}, {"เพื่อการเกษตร", "ธ.ก.ส. (BAAC)"},
	{"uob", "ยูโอบี (UOB)"}, {"cimb", "ซีไอเอ็มบี ไทย (CIMB)"},
	{"truemoney", "ทรูมันนี่ (TrueMoney)"}, {"ทรูมันนี่", "ทรูมันนี่ (TrueMoney)"},
	{"shopeepay", "ShopeePay"},
}

// findBank returns the bank whose keyword appears first (the app header, i.e. the sender's bank).
func findBank(compactText string) string {
	best, bestPos := "", -1
	for _, bk := range bankKeywords {
		if p := strings.Index(compactText, bk.key); p >= 0 && (bestPos < 0 || p < bestPos) {
			best, bestPos = bk.bank, p
		}
	}
	return best
}

func cleanName(s string) string {
	s = strings.Trim(strings.TrimSpace(s), ":：-|>•·")
	return strings.TrimSpace(spacesRe.ReplaceAllString(s, " "))
}

func digitRatio(s string) float64 {
	if s == "" {
		return 0
	}
	n := 0
	for _, r := range s {
		if r >= '0' && r <= '9' || r == 'x' {
			n++
		}
	}
	return float64(n) / float64(len([]rune(s)))
}

func isASCII(s string) bool {
	for i := 0; i < len(s); i++ {
		if s[i] > 127 {
			return false
		}
	}
	return true
}

func isLetter(b byte) bool { return b >= 'a' && b <= 'z' }
