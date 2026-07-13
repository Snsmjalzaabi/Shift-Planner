import { storage } from "@/src/utils/storage";

const TOKEN_KEY = "foxory_access_token";
const USER_KEY = "foxory_current_user";

export async function saveToken(token: string): Promise<void> {
  await storage.secureSet(TOKEN_KEY, token);
}

export async function loadToken(): Promise<string | null> {
  return await storage.secureGet<string>(TOKEN_KEY, "");
}

export async function clearToken(): Promise<void> {
  await storage.secureRemove(TOKEN_KEY);
}

export async function saveCachedUser(userJson: string): Promise<void> {
  await storage.setItem(USER_KEY, userJson);
}

export async function loadCachedUser(): Promise<string | null> {
  return await storage.getItem<string>(USER_KEY, "");
}

export async function clearCachedUser(): Promise<void> {
  await storage.removeItem(USER_KEY);
}
