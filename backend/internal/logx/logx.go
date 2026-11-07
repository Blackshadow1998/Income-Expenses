// Package logx holds the process-wide logger, so every package logs with the same prefix.
package logx

import (
	"log"
	"os"
)

var Logger = log.New(os.Stdout, "[api] ", log.LstdFlags)
