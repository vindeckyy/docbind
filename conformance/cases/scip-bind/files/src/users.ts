export interface User { id: string }

export function getUser(id: string): User {
  return { id };
}
