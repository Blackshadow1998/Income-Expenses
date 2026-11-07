// Package split works out who owes whom on a shared trip: each bill's shares, the debts between
// every pair of members, and a shorter list of transfers that settles everyone. Money is int64
// satang throughout; nothing here touches HTTP or the database.
package split

import (
	"errors"
	"fmt"
	"sort"
)

// Split modes of a bill.
const (
	Equal  = "equal"  // everyone listed pays the same
	Amount = "amount" // Part.Value is each person's share in satang
	Ratio  = "ratio"  // Part.Value is each person's weight, e.g. 2:1:1
)

// Part is one person sharing a bill. Value depends on the bill's Mode (unused for Equal).
type Part struct {
	Member int64
	Value  int64
}

// Bill is paid by Payer and shared by Parts, in the order members were listed.
type Bill struct {
	Payer  int64
	Amount int64 // satang
	Mode   string
	Parts  []Part
}

// Payment is money already handed over from one member to another.
type Payment struct {
	From, To int64
	Amount   int64
}

// Share is what one member owes towards a bill.
type Share struct {
	Member int64
	Amount int64
}

// Shares splits a bill. The satang left over when it doesn't divide evenly go to the payer when
// they share the bill, otherwise to the first person listed, so the shares always add up exactly.
func Shares(b Bill) ([]Share, error) {
	if b.Amount <= 0 {
		return nil, errors.New("ยอดบิลต้องมากกว่า 0")
	}
	if len(b.Parts) == 0 {
		return nil, errors.New("ต้องเลือกคนหารอย่างน้อย 1 คน")
	}
	seen := map[int64]bool{}
	for _, p := range b.Parts {
		if seen[p.Member] {
			return nil, errors.New("มีชื่อคนหารซ้ำ")
		}
		seen[p.Member] = true
	}
	out := make([]Share, len(b.Parts))
	switch b.Mode {
	case Equal, "":
		each := b.Amount / int64(len(b.Parts))
		for i, p := range b.Parts {
			out[i] = Share{p.Member, each}
		}
	case Amount:
		var sum int64
		for i, p := range b.Parts {
			if p.Value < 0 {
				return nil, errors.New("ยอดของแต่ละคนต้องไม่ติดลบ")
			}
			sum += p.Value
			out[i] = Share{p.Member, p.Value}
		}
		if sum != b.Amount {
			return nil, fmt.Errorf("ยอดที่แบ่งรวมกันได้ %s ไม่เท่ากับยอดบิล %s", Baht(sum), Baht(b.Amount))
		}
		return out, nil
	case Ratio:
		var total int64
		for _, p := range b.Parts {
			if p.Value <= 0 {
				return nil, errors.New("สัดส่วนของแต่ละคนต้องมากกว่า 0")
			}
			total += p.Value
		}
		for i, p := range b.Parts {
			out[i] = Share{p.Member, b.Amount * p.Value / total}
		}
	default:
		return nil, fmt.Errorf("unknown split mode %q", b.Mode)
	}
	var sum int64
	for _, s := range out {
		sum += s.Amount
	}
	out[remainderIndex(b)].Amount += b.Amount - sum
	return out, nil
}

func remainderIndex(b Bill) int {
	for i, p := range b.Parts {
		if p.Member == b.Payer {
			return i
		}
	}
	return 0
}

// Status of a debt between two members, after payments.
const (
	Unpaid  = "unpaid"
	Partial = "partial"
	Paid    = "paid"
)

// Pair is the debt left between two members once their debts to each other are netted:
// From owes To Owed in total, has paid Paid of it, and Remaining is still due (negative = overpaid).
type Pair struct {
	From, To  int64
	Owed      int64
	Paid      int64
	Remaining int64
	Status    string
}

// Pairwise nets the bills between every pair of members ("A owes B 333.33, B owes A 125" becomes
// "A pays B 208.33") and takes off what was paid between them. Pairs are in member order.
func Pairwise(members []int64, bills []Bill, payments []Payment) ([]Pair, error) {
	owe, err := debts(bills)
	if err != nil {
		return nil, err
	}
	paid := map[[2]int64]int64{}
	for _, p := range payments {
		paid[[2]int64{p.From, p.To}] += p.Amount
	}
	var out []Pair
	for i, a := range members {
		for _, b := range members[i+1:] {
			d := owe[[2]int64{a, b}] - owe[[2]int64{b, a}]
			from, to := a, b
			if d < 0 {
				from, to, d = b, a, -d
			}
			p := paid[[2]int64{from, to}] - paid[[2]int64{to, from}]
			if d == 0 && p == 0 {
				continue
			}
			pair := Pair{From: from, To: to, Owed: d, Paid: p, Remaining: d - p}
			switch {
			case p <= 0:
				pair.Status = Unpaid
			case pair.Remaining <= 0:
				pair.Status = Paid
			default:
				pair.Status = Partial
			}
			out = append(out, pair)
		}
	}
	return out, nil
}

// debts maps (debtor, creditor) to what the debtor owes for the creditor's bills.
func debts(bills []Bill) (map[[2]int64]int64, error) {
	owe := map[[2]int64]int64{}
	for _, b := range bills {
		shares, err := Shares(b)
		if err != nil {
			return nil, err
		}
		for _, s := range shares {
			if s.Member != b.Payer {
				owe[[2]int64{s.Member, b.Payer}] += s.Amount
			}
		}
	}
	return owe, nil
}

// Nets is each member's balance still to settle: positive = still to receive, negative = still to pay.
// It is what they paid for bills minus their shares, plus payments they made minus payments they got.
func Nets(members []int64, bills []Bill, payments []Payment) (map[int64]int64, error) {
	net := map[int64]int64{}
	for _, m := range members {
		net[m] = 0
	}
	for _, b := range bills {
		shares, err := Shares(b)
		if err != nil {
			return nil, err
		}
		net[b.Payer] += b.Amount
		for _, s := range shares {
			net[s.Member] -= s.Amount
		}
	}
	for _, p := range payments {
		net[p.From] += p.Amount
		net[p.To] -= p.Amount
	}
	return net, nil
}

// Transfer is one payment that settles part of the balances.
type Transfer struct {
	From, To int64
	Amount   int64
}

// Minimal settles the balances with few transfers: the biggest debtor pays the biggest creditor
// as much as either needs, repeatedly (greedy). Ties go by member order, so the result is stable.
func Minimal(members []int64, bills []Bill, payments []Payment) ([]Transfer, error) {
	net, err := Nets(members, bills, payments)
	if err != nil {
		return nil, err
	}
	type bal struct {
		member int64
		amount int64 // > 0
		order  int
	}
	var payers, getters []bal
	for i, m := range members {
		switch v := net[m]; {
		case v < 0:
			payers = append(payers, bal{m, -v, i})
		case v > 0:
			getters = append(getters, bal{m, v, i})
		}
	}
	biggest := func(s []bal) {
		sort.SliceStable(s, func(i, j int) bool {
			if s[i].amount != s[j].amount {
				return s[i].amount > s[j].amount
			}
			return s[i].order < s[j].order
		})
	}
	var out []Transfer
	for len(payers) > 0 && len(getters) > 0 {
		biggest(payers)
		biggest(getters)
		p, g := &payers[0], &getters[0]
		n := min(p.amount, g.amount)
		out = append(out, Transfer{p.member, g.member, n})
		p.amount -= n
		g.amount -= n
		if p.amount == 0 {
			payers = payers[1:]
		}
		if g.amount == 0 {
			getters = getters[1:]
		}
	}
	return out, nil
}

// Baht formats satang as "1,234.56".
func Baht(s int64) string {
	sign := ""
	if s < 0 {
		sign, s = "-", -s
	}
	whole, frac := s/100, s%100
	digits := fmt.Sprint(whole)
	for i := len(digits) - 3; i > 0; i -= 3 {
		digits = digits[:i] + "," + digits[i:]
	}
	return fmt.Sprintf("%s%s.%02d", sign, digits, frac)
}
