package viper

type Viper struct{}

type Config struct {
	Viper *Viper
}

type Handler interface {
	Handled(key string) any
}

func (v *Viper) Get(key string) any { return nil }

func (v *Viper) Reload(key string) any { return nil }

func (v *Viper) Swap(key string) any { return nil }

func (v *Viper) Copied(key string) any { return nil }

func (v *Viper) Param(key string) any { return nil }

func (v *Viper) FromDefault(key string) any { return nil }

func (v *Viper) Helper(key string) any { return nil }

func (v *Viper) Multi(key string) any { return nil }

func (v *Viper) Field(key string) any { return nil }

func (v *Viper) Asserted(key string) any { return nil }

func (v *Viper) Anonymous(key string) any { return nil }

func New() *Viper { return &Viper{} }

var Default = New()

func Load() (*Viper, error) { return New(), nil }
