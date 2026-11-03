package viper

import "example.com/viper/internal/client"

type Client = client.Client

const Limit = client.Limit

var ErrX = client.ErrX

func Wrap(value int) int { return client.Target(value) }
