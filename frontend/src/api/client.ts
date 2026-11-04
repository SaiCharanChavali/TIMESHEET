export type Role = 'EMPLOYEE' | 'MANAGER' | 'ADMIN';

export interface User {
  id: string;
  employeeCode: string;
  name: string;
  email: string;
  role: Role;
  mustChangePassword: boolean;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// Defaults to GET without a body and POST with one.
export async function api<T = void>(path: string, body?: unknown, method?: 'PATCH' | 'PUT' | 'DELETE'): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Could not reach the server. Check your connection and try again.');
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error ?? 'Something went wrong');
  return data as T;
}
