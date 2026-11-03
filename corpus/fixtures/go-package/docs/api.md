# API

Call `viper.ReadRemoteConfig()` and read `viper.SupportedExts`.

Call `viper.Client.Perform()` through the re-export.

Read `viper.Limit` and `viper.ErrX` through constant and variable re-exports.

Call `viper.Wrap(1)` through the wrapper re-export.

Call `viper.AppClient.Special()` through a chained type alias.

Call `viper.MethodValue(c, 1)` and `viper.WrapComputed(c, 1)` through method-valued and computed aliases.

Call `viper.WrapInstance(c, 1)` through an instance-method wrapper.

```go
v := viper.New()
v.Get("key")
```

```go
var r *Viper
r.Reload("key")
w := r
w.Copied("key")
var s *Viper
s = viper.New()
s.Swap("key")
```

```go
func f(v *Viper) {
    v.Param("key")
}
```

```go
v := viper.Default
v.FromDefault("key")
```

```go
func loadViper() *Viper { return New() }
func useHelper() {
    v := loadViper()
    v.Helper("key")
}
```

```go
v, err := viper.Load()
if err != nil { return }
v.Multi("key")
```

```go
cfg := Config{Viper: viper.New()}
cfg.Viper.Field("key")
```

```go
v := viper.Qualified
v.Qualified("key")
```

```go
v := viper.Default.(*Viper)
v.Asserted("key")
```
