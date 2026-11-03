package viper

type Viper struct{}

func (v *Viper) Get(key string) any { return nil }

func New() *Viper { return &Viper{} }
