package pkg

import "fmt"

type Client struct {
	Base string
}

func (c *Client) Request(path string) string {
	return fmt.Sprintf("%s%s", c.Base, path)
}

func GetUser(id string) string {
	return id
}
