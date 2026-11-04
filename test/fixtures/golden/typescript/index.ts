export interface User {
  id: string;
}

export type UserId = string;

export enum Role {
  Admin = "admin",
  Member = "member",
}

export class Client {
  request(path: string): Promise<User> {
    return Promise.resolve({ id: path });
  }
}

export function getUser(id: UserId): User {
  return { id };
}
