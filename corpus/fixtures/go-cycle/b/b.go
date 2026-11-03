package b

import "example.com/cycle/a"

const CycleBValue = a.CycleAValue

type CycleB = a.CycleA
