package other

type SelectedViper struct{}

func (v *SelectedViper) Qualified(key string) any { return nil }

var Selected *SelectedViper
