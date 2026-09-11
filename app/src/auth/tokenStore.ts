import AsyncStorage from "@react-native-async-storage/async-storage";

const TOKEN_KEY = "clocker.authToken";

// A plain module-level cache backed by AsyncStorage, so both the API client and the
// AuthContext can read the current token without importing each other.
let cachedToken: string | null | undefined;

export async function getToken(): Promise<string | null> {
  if (cachedToken !== undefined) return cachedToken;
  cachedToken = await AsyncStorage.getItem(TOKEN_KEY);
  return cachedToken;
}

// `persist` mirrors "remember me": false keeps the token in the in-memory cache only
// (so the app stays signed in until it's fully closed/reloaded) without writing it to
// AsyncStorage, so a relaunch doesn't come back signed in.
export async function setToken(token: string | null, persist = true): Promise<void> {
  cachedToken = token;
  if (token && persist) {
    await AsyncStorage.setItem(TOKEN_KEY, token);
  } else {
    await AsyncStorage.removeItem(TOKEN_KEY);
  }
}
