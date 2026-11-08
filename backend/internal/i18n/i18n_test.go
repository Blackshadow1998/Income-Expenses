package i18n

import (
	"context"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

func TestParse(t *testing.T) {
	cases := map[string]Lang{
		"":                           Thai,
		"th":                         Thai,
		"en":                         English,
		"EN":                         English,
		"en-US":                      English,
		"en-US,en;q=0.9":             English,
		"th-TH,th;q=0.9,en;q=0.8":    Thai,
		"fr-FR,en;q=0.5,th;q=0.9":    Thai,
		"fr-FR,de;q=0.8":             Thai,
		"en;q=0,th;q=0.1":            Thai,
		"de, en;q=0.7":               English,
		"*":                          Thai,
		"   en  ;  q=0.4 , zh;q=0.9": English,
	}
	for header, want := range cases {
		if got := Parse(header); got != want {
			t.Errorf("Parse(%q) = %q, want %q", header, got, want)
		}
	}
}

func TestT(t *testing.T) {
	cases := []struct {
		lang      Lang
		msg, want string
	}{
		{English, "กรุณาเข้าสู่ระบบ", "Please sign in"},
		{Thai, "กรุณาเข้าสู่ระบบ", "กรุณาเข้าสู่ระบบ"},
		{English, "invalid JSON body", "invalid JSON body"},       // already English
		{English, "ข้อความที่ไม่มีคำแปล", "ข้อความที่ไม่มีคำแปล"}, // no translation: as written
		{English, "", ""},
		{English, "PIN ไม่ถูกต้อง (เหลืออีก 2 ครั้ง)", "Wrong PIN (2 tries left)"},
		{English, "ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่", "Too many wrong passwords. Please wait 15 minutes and try again"},
		{English, "ใส่ PIN ผิด 5 ครั้ง กรุณาเข้าสู่ระบบด้วยรหัสผ่านอีกครั้ง", "Wrong PIN 5 times. Please sign in with your password again"},
		{English, "รหัสไม่ถูกต้อง (เหลืออีก 4 ครั้ง)", "Wrong code (4 tries left)"},
		{English, "บัญชีนี้ยังมีรายการรับ/จ่ายอยู่ 12 รายการ กรุณาย้ายหรือลบรายการก่อน", "This account still has 12 transactions. Move or delete them first"},
		{English, "ยอดที่แบ่งรวมกันได้ 1,200.50 ไม่เท่ากับยอดบิล 1,300.00", "The shares add up to 1,200.50, not the bill total 1,300.00"},
		{Thai, "PIN ไม่ถูกต้อง (เหลืออีก 2 ครั้ง)", "PIN ไม่ถูกต้อง (เหลืออีก 2 ครั้ง)"},
		{English, "xx PIN ไม่ถูกต้อง (เหลืออีก 2 ครั้ง)", "xx PIN ไม่ถูกต้อง (เหลืออีก 2 ครั้ง)"}, // patterns match whole messages only
	}
	for _, c := range cases {
		if got := T(c.lang, c.msg); got != c.want {
			t.Errorf("T(%s, %q) = %q, want %q", c.lang, c.msg, got, c.want)
		}
	}
}

func TestContext(t *testing.T) {
	if got := FromContext(context.Background()); got != Thai {
		t.Errorf("default = %q", got)
	}
	if got := FromContext(WithLang(context.Background(), English)); got != English {
		t.Errorf("stored = %q", got)
	}
}

func TestEnglishTexts(t *testing.T) {
	thai := regexp.MustCompile(`[\x{0E00}-\x{0E7F}]`)
	verb := regexp.MustCompile(`%[a-z]`)
	for th, en := range english {
		if !thai.MatchString(th) || en == "" || thai.MatchString(en) {
			t.Errorf("bad entry %q -> %q", th, en)
		}
		// fmt templates (the e-mail) must take the same values in both languages.
		if a, b := verb.FindAllString(th, -1), verb.FindAllString(en, -1); strings.Join(a, ",") != strings.Join(b, ",") {
			t.Errorf("%q: verbs %v vs %v", th, a, b)
		}
	}
}

func TestCategory(t *testing.T) {
	cases := []struct {
		lang             Lang
		code, name, want string
	}{
		{English, "expense", "จ่าย", "Expense"},
		{English, "lend_return", "รับคืนเงินยืม", "Loan paid back"},
		{Thai, "expense", "จ่าย", "จ่าย"},
		{English, "custom", "หมวดใหม่", "หมวดใหม่"}, // unknown code: the database name
		{English, "", "จ่าย", "จ่าย"},
	}
	for _, c := range cases {
		if got := Category(c.lang, c.code, c.name); got != c.want {
			t.Errorf("Category(%s, %q, %q) = %q, want %q", c.lang, c.code, c.name, got, c.want)
		}
	}
}

// Every Thai message the API can send has an English text: scans the packages that write
// responses for Thai string literals. Format strings are filled in and must translate as a whole.
func TestEveryMessageTranslated(t *testing.T) {
	// Thai that is not sent to an API client: CLI text (cmd/api's reset-password) and the pieces of
	// messages built by concatenation (covered by the patterns, see TestT).
	notMessages := []string{
		"ไม่พบชื่อผู้ใช้ %q",
		"ใส่ PIN ผิด ", " ครั้ง กรุณาเข้าสู่ระบบด้วยรหัสผ่านอีกครั้ง",
		"บัญชีนี้ยังมีรายการรับ/จ่ายอยู่ ", " รายการ กรุณาย้ายหรือลบรายการก่อน",
	}
	skipFiles := map[string]bool{}

	literal := regexp.MustCompile(`"((?:[^"\\\n]|\\.)*[\x{0E00}-\x{0E7F}](?:[^"\\\n]|\\.)*)"`)
	verbs := strings.NewReplacer("%d", "3", "%s", "100.00")
	checked := 0
	for _, pkg := range []string{"auth", "server", "split", "trip"} {
		files, _ := filepath.Glob(filepath.Join("..", pkg, "*.go"))
		for _, f := range files {
			if strings.HasSuffix(f, "_test.go") || skipFiles[filepath.Base(f)] {
				continue
			}
			src, err := os.ReadFile(f)
			if err != nil {
				t.Fatal(err)
			}
		lines:
			for n, line := range strings.Split(string(src), "\n") {
				if strings.HasPrefix(strings.TrimSpace(line), "//") {
					continue
				}
				// Drop a trailing comment, e.g. `json:"payee"` // optional "ผู้รับ".
				if i := strings.LastIndex(line, " // "); i >= 0 && strings.Count(line[:i], `"`)%2 == 0 {
					line = line[:i]
				}
				for _, m := range literal.FindAllStringSubmatch(line, -1) {
					msg, err := strconv.Unquote(`"` + m[1] + `"`)
					if err != nil {
						t.Fatalf("%s:%d: %v", f, n+1, err)
					}
					if _, ok := english[msg]; ok { // also fmt templates such as the e-mail
						checked++
						continue
					}
					for _, skip := range notMessages {
						if strings.HasPrefix(msg, skip) {
							continue lines
						}
					}
					checked++
					sample := verbs.Replace(msg)
					if T(English, sample) == sample {
						t.Errorf("%s:%d: no English for %q", f, n+1, msg)
					}
				}
			}
		}
	}
	if checked < 50 {
		t.Fatalf("only %d Thai messages found; is the scan still looking in the right place?", checked)
	}
}
