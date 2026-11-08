// Package i18n answers the API's messages in the client's language. The handlers keep writing
// their messages in Thai (the reference language); English is looked up from the Thai text, so a
// message without a translation is sent as written. English-only messages (e.g. "invalid JSON
// body") need no entry. User data and OCR keywords are never passed through here.
package i18n

import (
	"context"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

type Lang string

const (
	Thai    Lang = "th"
	English Lang = "en"
	Default      = Thai
)

// Parse picks the language from an Accept-Language header ("en", "en-US,en;q=0.9", "th-TH"):
// the supported language with the highest q-value wins, Thai when none is supported.
func Parse(header string) Lang {
	type choice struct {
		lang Lang
		q    float64
	}
	var choices []choice
	for _, part := range strings.Split(header, ",") {
		tag, params, _ := strings.Cut(strings.TrimSpace(part), ";")
		q := 1.0
		if v, ok := strings.CutPrefix(strings.TrimSpace(params), "q="); ok {
			if f, err := strconv.ParseFloat(v, 64); err == nil {
				q = f
			}
		}
		primary, _, _ := strings.Cut(strings.ToLower(strings.TrimSpace(tag)), "-")
		if l := Lang(primary); (l == Thai || l == English) && q > 0 {
			choices = append(choices, choice{l, q})
		}
	}
	if len(choices) == 0 {
		return Default
	}
	sort.SliceStable(choices, func(i, j int) bool { return choices[i].q > choices[j].q })
	return choices[0].lang
}

// Category is a shared category's name in lang, looked up by its code (like the app does); the name
// from the database for Thai or an unknown code.
func Category(lang Lang, code, name string) string {
	if en, ok := categories[code]; ok && lang == English {
		return en
	}
	return name
}

// T returns msg in lang: Thai as written, English from the table (or the patterns for messages
// with numbers in them), msg itself when there is no translation.
func T(lang Lang, msg string) string {
	if lang != English || msg == "" {
		return msg
	}
	if en, ok := english[msg]; ok {
		return en
	}
	for _, p := range patterns {
		if p.re.MatchString(msg) {
			return p.re.ReplaceAllString(msg, p.en)
		}
	}
	return msg
}

type ctxKey struct{}

// WithLang stores the request's language for code that has the context but not the writer.
func WithLang(ctx context.Context, lang Lang) context.Context {
	return context.WithValue(ctx, ctxKey{}, lang)
}

// FromContext is the language stored by WithLang, Thai when none was.
func FromContext(ctx context.Context) Lang {
	if l, ok := ctx.Value(ctxKey{}).(Lang); ok {
		return l
	}
	return Default
}

// The shared categories (seeded in internal/database), by code.
var categories = map[string]string{
	"income":       "Income",
	"expense":      "Expense",
	"lend":         "Lend",
	"borrow":       "Borrow",
	"lend_return":  "Loan paid back",
	"borrow_repay": "Loan repayment",
}

// Messages whose text includes a number or amount; $1, $2 are the captured values.
var patterns = []struct {
	re *regexp.Regexp
	en string
}{
	{regexp.MustCompile(`^ใส่รหัสผ่านผิดหลายครั้ง กรุณารอ (\d+) นาทีแล้วลองใหม่$`), "Too many wrong passwords. Please wait $1 minutes and try again"},
	{regexp.MustCompile(`^ใส่ PIN ผิด (\d+) ครั้ง กรุณาเข้าสู่ระบบด้วยรหัสผ่านอีกครั้ง$`), "Wrong PIN $1 times. Please sign in with your password again"},
	{regexp.MustCompile(`^PIN ไม่ถูกต้อง \(เหลืออีก (\d+) ครั้ง\)$`), "Wrong PIN ($1 tries left)"},
	{regexp.MustCompile(`^รหัสไม่ถูกต้อง \(เหลืออีก (\d+) ครั้ง\)$`), "Wrong code ($1 tries left)"},
	{regexp.MustCompile(`^บัญชีนี้ยังมีรายการรับ/จ่ายอยู่ (\d+) รายการ กรุณาย้ายหรือลบรายการก่อน$`), "This account still has $1 transactions. Move or delete them first"},
	{regexp.MustCompile(`^ยอดที่แบ่งรวมกันได้ (\S+) ไม่เท่ากับยอดบิล (\S+)$`), "The shares add up to $1, not the bill total $2"},
}

// Thai message -> English, by the package that sends it.
var english = map[string]string{
	// auth: sessions, sign-up, sign-in, PIN, passwords
	"กรุณาเข้าสู่ระบบ":                                     "Please sign in",
	"กรุณาตั้งรหัสผ่านใหม่ก่อนใช้งาน":                      "Please set a new password first",
	"กรุณาตั้ง PIN ก่อนใช้งาน":                             "Please set a PIN first",
	"กรุณาใส่ PIN":                                         "Please enter your PIN",
	"ชื่อผู้ใช้ต้องยาว 3–32 ตัว ใช้ได้เฉพาะ a-z 0-9 . _ -": "Usernames must be 3–32 characters: a-z 0-9 . _ - only",
	"รหัสผ่านต้องยาว 8–72 ตัวอักษร":                        "Passwords must be 8–72 characters",
	"รหัสผ่านใหม่ต้องยาว 8–72 ตัวอักษร":                    "The new password must be 8–72 characters",
	"ชื่อที่แสดงยาวเกิน 50 ตัวอักษร":                       "The display name is longer than 50 characters",
	"รูปแบบอีเมลไม่ถูกต้อง":                                "Invalid e-mail address",
	"ชื่อผู้ใช้นี้มีคนใช้แล้ว":                             "This username is already taken",
	"อีเมลนี้มีบัญชีอื่นใช้อยู่แล้ว":                       "Another account already uses this e-mail",
	"ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง":                     "Wrong username or password",
	"รหัสผ่านปัจจุบันไม่ถูกต้อง":                           "The current password is wrong",
	"บัญชีนี้ไม่ได้ใช้รหัสผ่านในการเข้าสู่ระบบ":            "This account does not sign in with a password",
	"PIN ต้องเป็นตัวเลข 6 หลัก":                            "The PIN must be 6 digits",
	"PIN ง่ายเกินไป (เช่น 000000, 123456) กรุณาเลือกใหม่":  "That PIN is too easy to guess (e.g. 000000, 123456). Please choose another",

	// auth: forgot password (incl. the "message" of the send-code answer)
	"ถ้ามีบัญชีที่ใช้อีเมลนี้ เราส่งรหัส 6 หลักไปแล้ว ใช้ได้ภายใน 3 นาที (เช็กในจดหมายขยะด้วย)": "If an account uses this e-mail, we have sent it a 6-digit code. It works for 3 minutes (check your spam folder too)",
	"ยังไม่ได้ตั้งค่าการส่งอีเมล กรุณาติดต่อผู้ดูแล":                                            "Sending e-mail is not set up. Please contact the administrator",
	"รหัสไม่ถูกต้องหรือหมดอายุ กรุณาขอรหัสใหม่":                                                 "The code is wrong or has expired. Please request a new one",
	"บัญชีนี้เข้าสู่ระบบด้วย Google ไม่มีรหัสผ่านให้ตั้งใหม่":                                   "This account signs in with Google and has no password to reset",

	// auth: Google
	"ยังไม่ได้เปิดใช้การเข้าสู่ระบบด้วย Google": "Sign-in with Google is not enabled",
	"ยืนยันตัวตนกับ Google ไม่สำเร็จ":           "Could not verify your Google account",
	"บัญชี Google นี้ผูกกับผู้ใช้อื่นอยู่แล้ว":  "This Google account is already linked to another user",

	// server: ledger
	"จำนวนเงินต้องมากกว่า 0":                 "The amount must be greater than 0",
	"วันที่ต้องอยู่ระหว่าง 1–31":             "The day must be between 1 and 31",
	"บัญชีต้นทางและปลายทางต้องเป็นคนละบัญชี": "The source and destination must be different accounts",
	"ชื่อรายการต้องยาว 1–60 ตัวอักษร":        "Item names must be 1–60 characters",
	"มีรายการชื่อนี้ในหมวดนี้แล้ว":           "This category already has an item with this name",
	"ชื่อกฎต้องยาว 1–40 ตัวอักษร":            "Rule names must be 1–40 characters",
	"กรุณาใส่คำที่ต้องเจอในชื่อ":             "Please enter the word to look for in the name",
	"กรุณาเลือกหมวดหมู่":                     "Please choose a category",

	// server: slips (incl. the per-file results of an upload)
	"สลิปนี้ถูกคอนเฟิร์มหรือถูกลบไปแล้ว":         "This slip has already been confirmed or deleted",
	"สลิปนี้คอนเฟิร์มแล้ว ให้ลบที่รายการแทน":     "This slip is already confirmed. Delete its transaction instead",
	"ลิงก์รูปสลิปหมดอายุ กรุณาเปิดหน้าใหม่":      "The slip image link has expired. Please reopen the page",
	"อัปโหลดไม่สำเร็จ (ไฟล์รวมต้องไม่เกิน 60MB)": "Upload failed (60MB in total at most)",
	"ไม่พบไฟล์ (ใช้ field ชื่อ files)":           "No files found (use the field named files)",
	"เปิดไฟล์ไม่ได้":                             "Could not open the file",
	"อ่านไฟล์ไม่ได้":                             "Could not read the file",
	"ไฟล์ใหญ่เกิน 10MB":                          "The file is larger than 10MB",
	"รองรับเฉพาะรูป PNG, JPG, WEBP":              "Only PNG, JPG and WEBP images are supported",
	"สลิปนี้เคยอัปโหลดแล้ว":                      "This slip was already uploaded",
	"สลิปเลขที่รายการนี้เคยอัปโหลดแล้ว":          "A slip with this reference number was already uploaded",
	"เกิดข้อผิดพลาดในระบบ":                       "Something went wrong on the server",
	"บันทึกรูปไม่สำเร็จ":                         "Could not save the image",
	"บันทึกสลิปไม่สำเร็จ":                        "Could not save the slip",
	"บันทึกแล้วแต่อ่านข้อมูลกลับไม่ได้":          "Saved, but could not read it back",

	// split: bill maths
	"ยอดบิลต้องมากกว่า 0":            "The bill must be more than 0",
	"ต้องเลือกคนหารอย่างน้อย 1 คน":   "Choose at least 1 person to share it",
	"มีชื่อคนหารซ้ำ":                 "A person is listed twice",
	"ยอดของแต่ละคนต้องไม่ติดลบ":      "Each person's amount cannot be negative",
	"สัดส่วนของแต่ละคนต้องมากกว่า 0": "Each person's ratio must be greater than 0",

	// trip
	"กรุณาตั้งชื่อทริป (ไม่เกิน 60 ตัวอักษร)":                                    "Please name the trip (60 characters at most)",
	"กรุณาใส่ชื่อสมาชิก (ไม่เกิน 40 ตัวอักษร)":                                   "Please enter a member name (40 characters at most)",
	"มีสมาชิกชื่อนี้ในทริปแล้ว":                                                  "The trip already has a member with this name",
	"ลบไม่ได้: สมาชิกคนนี้มีบิลหรือการจ่ายเงินอยู่ ให้ลบหรือแก้บิลเหล่านั้นก่อน": "Cannot remove: this member has bills or payments. Delete or edit those first",
	"กรุณาใส่ชื่อรายการ (ไม่เกิน 80 ตัวอักษร)":                                   "Please enter what the bill is for (80 characters at most)",
	"กรุณาเลือกผู้จ่าย":                                                          "Please choose who paid",
	"คนหารต้องเป็นสมาชิกของทริป":                                                 "Everyone sharing must be a member of the trip",
	"สัดส่วนต้องเป็นจำนวนเต็ม":                                                   "Ratios must be whole numbers",
	"ผู้จ่ายและผู้รับต้องเป็นสมาชิกของทริป และเป็นคนละคน":                        "The payer and receiver must be two different members of the trip",
	"ส่งรูปแบบ multipart/form-data (ไม่เกิน 10MB)":                               "Send the image as multipart/form-data (10MB at most)",
	"ส่งข้อมูลแบบ multipart/form-data (สลิปไม่เกิน 10MB)":                        "Send the data as multipart/form-data (slip 10MB at most)",
	"กรุณาเลือกรูป":                                                              "Please choose an image",
	"ไฟล์รูปใหญ่เกิน 10MB":                                                       "The image is larger than 10MB",
	"รองรับเฉพาะรูป PNG, JPG หรือ WEBP":                                          "Only PNG, JPG or WEBP images are supported",
	"อ่านรูปไม่สำเร็จ กรอกเองได้เลย":                                             "Could not read the image; fill it in yourself",
	"ลิงก์รูปหมดอายุ กรุณาเปิดหน้าใหม่":                                          "The image link has expired. Please reopen the page",

	// export.go: CSV header and the words the CSV writes itself
	"วันที่":           "Date",
	"ประเภท":           "Type",
	"หมวด":             "Category",
	"รายการ":           "Item",
	"จำนวนเงิน":        "Amount",
	"บัญชี":            "Account",
	"ผู้รับ / ไปบัญชี": "Payee / to account",
	"รายละเอียด":       "Details",
	"รายรับ":           "Income",
	"รายจ่าย":          "Expense",
	"ไม่ระบุบัญชี":     "No account",
	"โอนระหว่างบัญชี":  "Transfer between accounts",

	// forgot.go: the verification e-mail (fmt templates: %s is the code)
	"รายรับรายจ่าย":                 "Income & Expenses",
	"รหัสยืนยัน %s — รายรับรายจ่าย": "Verification code %s — Income & Expenses",
	"รหัสยืนยันสำหรับตั้งรหัสผ่านใหม่ของคุณคือ\n\n    %s\n\nใช้ได้ภายใน 3 นาที และใช้ได้ครั้งเดียว\nถ้าคุณไม่ได้ขอรหัสนี้ ไม่ต้องทำอะไร รหัสผ่านของคุณยังเหมือนเดิม\n\n— รายรับรายจ่าย": "Your code for setting a new password is\n\n    %s\n\nIt works for 3 minutes and only once.\nIf you did not ask for this code, do nothing: your password stays the same.\n\n— Income & Expenses",
}
