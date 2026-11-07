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
	"unicode"
)

// SlipData is what we could read from a bank transfer slip. Empty/zero fields were not found.
type SlipData struct {
	Date     string  // YYYY-MM-DD
	Amount   float64 // baht
	FromName string  // sender account name
	ToName   string  // receiver account name
	Ref      string  // transaction reference number
	Bank     string  // sender bank, matching banks.name
	ToBank   string  // receiver bank, matching banks.name
}

// upscaledMark separates the reading of the original image from the reading of the enlarged copy in
// the stored OCR text (see runOCR, parseSlipText).
const upscaledMark = "===== 2x ====="

// runOCR reads the slip twice: as is, and enlarged 2x. Small screenshot text keeps its Thai vowel
// marks and account digits better enlarged, while dates often read better at the original size, so
// both readings are kept and merged field by field. Enlarging is best effort.
func runOCR(ctx context.Context, imagePath string) (string, error) {
	orig, err := tesseract(ctx, imagePath)
	if err != nil {
		return "", err
	}
	big, err := enlarge(ctx, imagePath)
	if err != nil {
		return orig, nil
	}
	defer os.Remove(big)
	up, err := tesseract(ctx, big)
	if err != nil || strings.TrimSpace(up) == "" {
		return orig, nil
	}
	return orig + "\n" + upscaledMark + "\n" + up, nil
}

// enlarge writes a 2x copy of the image as a temporary PNG with ImageMagick (its resize filter gave
// clearly better OCR than Go's image scalers), capped at 4000 px a side; the caller removes it.
func enlarge(ctx context.Context, path string) (string, error) {
	out, err := os.CreateTemp("", "slip-2x-*.png")
	if err != nil {
		return "", err
	}
	out.Close()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	cmd := exec.CommandContext(ctx, "magick", path+"[0]", "-resize", "200%", "-resize", "4000x4000>", out.Name())
	if msg, err := cmd.CombinedOutput(); err != nil {
		os.Remove(out.Name())
		return "", fmt.Errorf("magick: %v: %s", err, strings.TrimSpace(string(msg)))
	}
	return out.Name(), nil
}

// parseSlipText parses stored OCR text: the original reading, optionally followed by the reading of
// the enlarged image. Fields come from the original; the enlarged one fills gaps and fuller names.
func parseSlipText(text string) SlipData {
	orig, big, ok := strings.Cut(text, "\n"+upscaledMark+"\n")
	d := parseSlip(orig)
	if !ok {
		return d
	}
	o := parseSlip(big)
	if d.Date == "" {
		d.Date = o.Date
	}
	if d.Amount == 0 {
		d.Amount = o.Amount
	}
	if d.Ref == "" {
		d.Ref = o.Ref
	}
	if d.Bank == "" {
		d.Bank = o.Bank
	}
	if d.ToBank == "" {
		d.ToBank = o.ToBank
	}
	d.FromName = betterName(d.FromName, o.FromName)
	d.ToName = betterName(d.ToName, o.ToName)
	return d
}

// betterName keeps reading a unless it is missing or noise, or b is the same name with more of its
// vowel marks (or more of it): "นาย เอกฤกษ กจธมน" -> "นาย เอกฤกษ์ กิจธิมน".
func betterName(a, b string) string {
	switch {
	case b == "":
		return a
	case a == "" || letterCount(a) < 3:
		return b
	}
	ka, kb := matchKey(a), matchKey(b)
	if (strings.Contains(kb, ka) || strings.Contains(ka, kb)) && len([]rune(b)) > len([]rune(a)) {
		return b
	}
	return a
}

// tesseract reads text from an image (Thai + English).
func tesseract(ctx context.Context, imagePath string) (string, error) {
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
		alts = append(alts, looseAbbrev(short[i]))
	}
	// Day, month (full names first so they win over abbreviations), year.
	// Dots are stripped before matching; OCR may add spaces between Thai letters.
	thMonthRe = regexp.MustCompile(`(\d{1,2})\s*(` + strings.Join(alts, "|") + `)\s*[,']?\s*(\d{4}|\d{2})(?:\D|$)`)
	// Tesseract often reads a lone "7" in front of a Thai month as "ว" ("ว พย, 69").
	sevenAsWoRe = regexp.MustCompile(`(^|\s)ว(\s*(?:` + strings.Join(alts, "|") + `)\s*[,']?\s*(?:\d{4}|\d{2}))`)
}

var sevenAsWoRe *regexp.Regexp

// looseThai allows optional whitespace between every rune.
func looseThai(s string) string {
	var parts []string
	for _, r := range s {
		parts = append(parts, regexp.QuoteMeta(string(r)))
	}
	return strings.Join(parts, `\s*`)
}

// looseAbbrev is looseThai for month abbreviations, where OCR often reads the dot between letters
// as a below-vowel mark (พ.ย. -> "พุย").
func looseAbbrev(s string) string {
	var parts []string
	for _, r := range s {
		parts = append(parts, regexp.QuoteMeta(string(r)))
	}
	return strings.Join(parts, `[\s\x{0E38}\x{0E39}\x{0E3A},']*`)
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
	d := SlipData{
		Date:     findDate(lines),
		Amount:   findAmount(lines, keys),
		FromName: findLabeled(lines, keys, []string{"จาก", "ผู้โอน", "from"}),
		ToName:   findLabeled(lines, keys, []string{"ไปยัง", "ไปที่", "ถึง", "ผู้รับ", "to"}),
		Ref:      findRef(lines, keys),
		Bank:     findBank(strings.Join(keys, "\n")),
	}.withNameFallback(lines, keys)
	d.ToBank = findToBank(lines, keys, d.FromName, d.ToName)
	return d
}

// findToBank is the first bank named below the receiver's name (where slips put it), before the
// amount / fee part. OCR noise lines (account numbers, a garbled company name) may sit in between.
func findToBank(lines, keys []string, fromName, toName string) string {
	start, end := receiverBlock(lines, keys, fromName, toName)
	if start < 0 || toName == "" || !lineHasName(lines[start], toName) {
		return "" // below the sender's name is the sender's own bank
	}
	for j := start + 1; j < end; j++ {
		if b := findBank(keys[j]); b != "" {
			return b
		}
	}
	return ""
}

// lineHasName: the OCR line holds the name as parsed (which may have had OCR words fixed, see fixOCRWords).
func lineHasName(line, name string) bool {
	return strings.Contains(line, name) || strings.Contains(fixOCRWords(line), name)
}

// receiverBlock is the line range [start, end) holding the receiver: from the line with the receiver's
// name (looked for below the sender's, which may contain it on a transfer to oneself), or the line after
// the sender's name when the receiver wasn't read, up to the amount / fee lines. start is -1 when
// neither name is found.
func receiverBlock(lines, keys []string, fromName, toName string) (start, end int) {
	from := -1
	for i, l := range lines {
		if fromName != "" && lineHasName(l, fromName) {
			from = i
			break
		}
	}
	start = -1
	if toName != "" {
		for _, first := range []int{from + 1, 0} {
			for i := first; i < len(lines) && start < 0; i++ {
				if lineHasName(lines[i], toName) {
					start = i
				}
			}
			if start >= 0 {
				break
			}
		}
	}
	if start < 0 && from >= 0 {
		start = from + 1
	}
	if start < 0 || start >= len(lines) {
		return -1, -1
	}
	end = len(lines)
	for j := start + 1; j < len(lines); j++ {
		if strings.Contains(keys[j], "จำนวน") || strings.Contains(keys[j], "amount") || isFeeLine(keys[j]) {
			end = j
			break
		}
	}
	return start, end
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
		noDots := sevenAsWoRe.ReplaceAllString(strings.ReplaceAll(l, ".", ""), "${1}7${2}")
		if m := thMonthRe.FindStringSubmatch(noDots); m != nil {
			if d := makeDate(m[1], thaiMonth(m[2]), m[3]); d != "" {
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

// thaiMonth maps a matched month name to 1–12. Full names keep their vowels; abbreviations may carry
// OCR noise marks in place of the dots (see looseAbbrev), which are dropped before the lookup.
func thaiMonth(s string) int {
	s = spacesRe.ReplaceAllString(s, "")
	if m, ok := thMonthIdx[s]; ok {
		return m
	}
	return thMonthIdx[strings.NewReplacer("ุ", "", "ู", "", "ฺ", "", ",", "", "'", "").Replace(s)]
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
	"บจก", "บริษัท", "บรษท", "บริษท", "หจก", "ร้าน", "บมจ", "co", "company"}

var (
	leadingJunkRe = regexp.MustCompile(`^[^\p{L}]+`)              // OCR noise before a name, e.g. ") นาย" or "๓@ ร้าน"
	accountRe     = regexp.MustCompile(`[xX%*•\d][xX%*•\d-]{6,}`) // masked account number, e.g. xxx-x-x1234-x
	slipLabels    = []string{"จำนวน", "เลขที่", "รหัส", "สำเร็จ", "ค่าธรรม", "บาท", "amount", "ref"}
)

// withNameFallback fills missing names on slips without จาก/ไปยัง labels (K PLUS style): the sender
// is the first line starting with a personal/company title; the receiver is the next titled line or,
// for shops and billers without a title, the first name-like line after the sender's account number.
func (d SlipData) withNameFallback(lines, keys []string) SlipData {
	if d.FromName != "" && d.ToName != "" {
		return d
	}
	fromAt := -1
	for i := range lines {
		name, titled := titledName(lines[i])
		switch {
		case !titled:
		case d.FromName == "" && name != d.ToName:
			d.FromName, fromAt = name, i
		case d.ToName == "" && name != d.FromName:
			d.ToName = name
		}
	}
	if d.ToName != "" || fromAt < 0 {
		return d
	}
	for i := fromAt + 1; i < len(lines); i++ {
		if !accountRe.MatchString(strings.ReplaceAll(lines[i], " ", "")) {
			continue
		}
		for j := i + 1; j < len(lines); j++ {
			if name, ok := nameLike(lines[j], keys[j]); ok {
				d.ToName = name
				return d
			}
			if isFeeLine(keys[j]) || strings.Contains(keys[j], "จำนวน") {
				return d
			}
		}
		return d
	}
	return d
}

// titledName returns the line as a name when it starts with a personal/company title, after dropping
// OCR junk around it (see junkFreeName).
func titledName(line string) (string, bool) {
	name := junkFreeName(line)
	k := compact(name)
	for _, p := range namePrefixes {
		if strings.HasPrefix(k, p) && digitRatio(k) < 0.3 {
			return fixOCRWords(name), true
		}
	}
	return "", false
}

// junkFreeName is the line without the OCR junk around a name: symbols and junk words in front, and
// everything from the first junk word after that ("ย๒» บรษท ...", "นาย สมชาย ใจดี 2 ชู", "G0 ไลน์แมน ว%").
func junkFreeName(line string) string {
	words := strings.Fields(leadingJunkRe.ReplaceAllString(line, ""))
	for len(words) > 0 && junkWord(words[0]) {
		words = words[1:]
	}
	for i := 1; i < len(words); i++ {
		if junkWord(words[i]) {
			words = words[:i]
			break
		}
	}
	return cleanName(strings.Join(words, " "))
}

func letterCount(s string) int {
	n := 0
	for _, r := range s {
		if unicode.IsLetter(r) {
			n++
		}
	}
	return n
}

// junkWord is an OCR artifact: it has digits or symbols, or is a lone Latin letter ("O", "x").
func junkWord(w string) bool {
	if r := []rune(w); len(r) == 1 && r[0] < 0x80 {
		return true
	}
	for _, r := range w {
		if !unicode.IsLetter(r) && !unicode.Is(unicode.Mn, r) && r != '.' {
			return true
		}
	}
	return false
}

// ocrWordFixes restores words Tesseract reads without their vowel marks.
var ocrWordFixes = map[string]string{"บรษท": "บริษัท", "บรษัท": "บริษัท", "บริษท": "บริษัท", "จากด": "จำกัด", "จำกด": "จำกัด", "จากัด": "จำกัด", "น่าย": "นาย"}

func fixOCRWords(name string) string {
	words := strings.Fields(name)
	for i, w := range words {
		if f, ok := ocrWordFixes[w]; ok {
			words[i] = f
		}
	}
	return strings.Join(words, " ")
}

// nameLike returns the line as a name when, after dropping OCR junk in front, it is mostly letters
// and not a bank name or one of the slip's own labels.
func nameLike(line, key string) (string, bool) {
	name := fixOCRWords(junkFreeName(line))
	// Untitled names are shops/billers: a lone letter at the end is noise ("ไลน์แมน ว"), unlike the
	// shortened surname after a personal title.
	if words := strings.Fields(name); len(words) > 1 && letterCount(words[len(words)-1]) == 1 {
		name = strings.Join(words[:len(words)-1], " ")
	}
	letters := 0
	for _, r := range name {
		if unicode.IsLetter(r) {
			letters++
		}
	}
	if letters < 2 || digitRatio(compact(name)) >= 0.3 || findBank(key) != "" {
		return "", false
	}
	for _, l := range slipLabels {
		if strings.Contains(key, l) {
			return "", false
		}
	}
	return name, true
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
