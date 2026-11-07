// Package money converts between baht (what the API speaks) and integer satang (what is stored).
package money

import "math"

func ToSatang(baht float64) int64 { return int64(math.Round(baht * 100)) }
func FromSatang(s int64) float64  { return float64(s) / 100 }
func Round2(v float64) float64    { return math.Round(v*100) / 100 }
