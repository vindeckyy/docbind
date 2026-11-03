package client

type Client struct{}

func (c *Client) Perform() error { return nil }

const Limit = 5

var ErrX = 1

func Target(value int) int { return value }

func (c *Client) Special() error { return nil }

func (c *Client) Computed(value int) error { return nil }

func (c *Client) Wrapped(value int) error { return nil }
