export type UserCacheInvalidator = {
  invalidate(userId: string | string[], trigger?: string): Promise<void>;
};

let invalidator: UserCacheInvalidator | null = null;

export function setUserCacheInvalidator(service: UserCacheInvalidator | null): void {
  invalidator = service;
}

export function getUserCacheInvalidator(): UserCacheInvalidator | null {
  return invalidator;
}
