package split

import (
	"reflect"
	"testing"
)

const (
	A int64 = iota + 1
	B
	C
	D
	E
)

var group = []int64{A, B, C, D, E}

func parts(members ...int64) []Part {
	out := make([]Part, len(members))
	for i, m := range members {
		out[i] = Part{Member: m}
	}
	return out
}

// The trip from the spec: A pays 500 for A B C D, B pays 1000 for A B D, A pays 400 for A D E.
var tripBills = []Bill{
	{Payer: A, Amount: 50000, Mode: Equal, Parts: parts(A, B, C, D)},
	{Payer: B, Amount: 100000, Mode: Equal, Parts: parts(A, B, D)},
	{Payer: A, Amount: 40000, Mode: Equal, Parts: parts(A, D, E)},
}

func TestShares(t *testing.T) {
	cases := []struct {
		name string
		bill Bill
		want []Share
		err  bool
	}{
		{"even split", Bill{Payer: A, Amount: 50000, Parts: parts(A, B, C, D)},
			[]Share{{A, 12500}, {B, 12500}, {C, 12500}, {D, 12500}}, false},
		{"leftover satang goes to the payer", Bill{Payer: B, Amount: 100000, Parts: parts(A, B, D)},
			[]Share{{A, 33333}, {B, 33334}, {D, 33333}}, false},
		{"several leftover satang, all to the payer", Bill{Payer: C, Amount: 1000, Parts: parts(A, B, C, D, E, 6, 7)},
			[]Share{{A, 142}, {B, 142}, {C, 148}, {D, 142}, {E, 142}, {6, 142}, {7, 142}}, false},
		{"payer not sharing: leftover to the first listed", Bill{Payer: E, Amount: 1000, Parts: parts(B, C, D)},
			[]Share{{B, 334}, {C, 333}, {D, 333}}, false},
		{"by amount", Bill{Payer: A, Amount: 100000, Mode: Amount, Parts: []Part{{A, 20000}, {B, 50000}, {C, 30000}}},
			[]Share{{A, 20000}, {B, 50000}, {C, 30000}}, false},
		{"by amount must add up to the bill", Bill{Payer: A, Amount: 100000, Mode: Amount, Parts: []Part{{A, 20000}, {B, 50000}}},
			nil, true},
		{"by ratio 2:1:1", Bill{Payer: A, Amount: 100000, Mode: Ratio, Parts: []Part{{A, 2}, {B, 1}, {C, 1}}},
			[]Share{{A, 50000}, {B, 25000}, {C, 25000}}, false},
		{"by ratio with leftover", Bill{Payer: B, Amount: 1000, Mode: Ratio, Parts: []Part{{A, 1}, {B, 1}, {C, 1}}},
			[]Share{{A, 333}, {B, 334}, {C, 333}}, false},
		{"ratio needs positive weights", Bill{Payer: A, Amount: 1000, Mode: Ratio, Parts: []Part{{A, 1}, {B, 0}}}, nil, true},
		{"no one sharing", Bill{Payer: A, Amount: 1000}, nil, true},
		{"zero amount", Bill{Payer: A, Amount: 0, Parts: parts(A)}, nil, true},
		{"same person twice", Bill{Payer: A, Amount: 1000, Parts: parts(A, A)}, nil, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Shares(c.bill)
			if c.err {
				if err == nil {
					t.Fatalf("want an error, got %v", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
			var sum int64
			for _, s := range got {
				sum += s.Amount
			}
			if sum != c.bill.Amount {
				t.Fatalf("shares add up to %d, bill is %d", sum, c.bill.Amount)
			}
		})
	}
}

func TestPairwise(t *testing.T) {
	cases := []struct {
		name     string
		bills    []Bill
		payments []Payment
		want     []Pair
	}{
		{"trip from the spec", tripBills, nil, []Pair{
			{From: A, To: B, Owed: 20833, Remaining: 20833, Status: Unpaid},
			{From: C, To: A, Owed: 12500, Remaining: 12500, Status: Unpaid},
			{From: D, To: A, Owed: 25833, Remaining: 25833, Status: Unpaid},
			{From: E, To: A, Owed: 13333, Remaining: 13333, Status: Unpaid},
			{From: D, To: B, Owed: 33333, Remaining: 33333, Status: Unpaid},
		}},
		{"partly and fully paid", tripBills, []Payment{{D, A, 10000}, {D, A, 5000}, {C, A, 12500}, {E, A, 14000}}, []Pair{
			{From: A, To: B, Owed: 20833, Remaining: 20833, Status: Unpaid},
			{From: C, To: A, Owed: 12500, Paid: 12500, Remaining: 0, Status: Paid},
			{From: D, To: A, Owed: 25833, Paid: 15000, Remaining: 10833, Status: Partial},
			{From: E, To: A, Owed: 13333, Paid: 14000, Remaining: -667, Status: Paid}, // overpaid
			{From: D, To: B, Owed: 33333, Remaining: 33333, Status: Unpaid},
		}},
		{"a payment the other way adds to the debt", []Bill{{Payer: A, Amount: 1000, Parts: parts(A, B)}}, []Payment{{A, B, 200}}, []Pair{
			{From: B, To: A, Owed: 500, Paid: -200, Remaining: 700, Status: Unpaid},
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Pairwise(group, c.bills, c.payments)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got  %+v\nwant %+v", got, c.want)
			}
		})
	}
}

func TestNets(t *testing.T) {
	cases := []struct {
		name     string
		bills    []Bill
		payments []Payment
		want     map[int64]int64
	}{
		{"trip from the spec", tripBills, nil, map[int64]int64{A: 30833, B: 54166, C: -12500, D: -59166, E: -13333}},
		{"after a partial payment", tripBills, []Payment{{D, B, 30000}}, map[int64]int64{A: 30833, B: 24166, C: -12500, D: -29166, E: -13333}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Nets(group, c.bills, c.payments)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
			var sum int64
			for _, v := range got {
				sum += v
			}
			if sum != 0 {
				t.Fatalf("balances add up to %d, want 0", sum)
			}
		})
	}
}

func TestMinimal(t *testing.T) {
	cases := []struct {
		name     string
		bills    []Bill
		payments []Payment
		want     []Transfer
	}{
		{"trip from the spec: biggest debtor to biggest creditor", tripBills, nil, []Transfer{
			{D, B, 54166}, {E, A, 13333}, {C, A, 12500}, {D, A, 5000},
		}},
		{"settled pairs drop out", tripBills, []Payment{{D, B, 54166}, {E, A, 13333}, {C, A, 12500}}, []Transfer{
			{D, A, 5000},
		}},
		{"all settled", tripBills, []Payment{{D, B, 54166}, {E, A, 13333}, {C, A, 12500}, {D, A, 5000}}, nil},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, err := Minimal(group, c.bills, c.payments)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Fatalf("got %v, want %v", got, c.want)
			}
		})
	}
}

func TestBaht(t *testing.T) {
	for in, want := range map[int64]string{0: "0.00", 20833: "208.33", -59166: "-591.66", 123456789: "1,234,567.89", 5: "0.05"} {
		if got := Baht(in); got != want {
			t.Errorf("Baht(%d) = %q, want %q", in, got, want)
		}
	}
}
