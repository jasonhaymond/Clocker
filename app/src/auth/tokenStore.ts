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

// Whether the current session was signed in with "remember me" on (token written to
// AsyncStorage) vs. off (in-memory only). Used when replacing the token after a password
// change, so the fresh one gets stored the same way the original sign-in chose.
export async function isTokenPersisted(): Promise<boolean> {
  return (await AsyncStorage.getItem(TOKEN_KEY)) !== null;
}
