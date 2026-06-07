export type RegistrationStep =
  | "idle"
  | "awaiting_team_name"
  | "awaiting_username"
  | "awaiting_logo";

export interface UserState {
  step: RegistrationStep;
  teamName?: string;
  telegramUsername?: string;
}

const states = new Map<number, UserState>();

export function getState(userId: number): UserState {
  return states.get(userId) ?? { step: "idle" };
}

export function setState(userId: number, state: UserState): void {
  states.set(userId, state);
}

export function clearState(userId: number): void {
  states.delete(userId);
}
