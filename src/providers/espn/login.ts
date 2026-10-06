/** Where the in-app ESPN sign-in hands espn_s2 + SWID back to the ESPN account screen. */
export const ESPN_LOGIN_KEY = 'espn_login_pending_v1';

export type EspnLoginResult = { espnS2: string; swid: string; at: number };
