export interface User {
  id: string;
  email: string;
}

export function getUser(id: string): User {
  return { id, email: "" };
}
