package viper

type Viper struct{}

func (v *Viper) Get(key string) any { return nil }

func (v *Viper) Reload(key string) any { return nil }

func (v *Viper) Swap(key string) any { return nil }

func (v *Viper) Copied(key string) any { return nil }

func (v *Viper) Param(key string) any { return nil }

func (v *Viper) FromDefault(key string) any { return nil }

func (v *Viper) Helper(key string) any { return nil }

func New() *Viper { return &Viper{} }

var Default = New()
