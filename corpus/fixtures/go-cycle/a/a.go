package a

import "example.com/cycle/b"

const CycleAValue = b.CycleBValue

type CycleA = b.CycleB
