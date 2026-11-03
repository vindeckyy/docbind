package client

type Client struct{}

func (c *Client) Perform() error { return nil }

const Limit = 5

var ErrX = 1

func Target(value int) int { return value }
