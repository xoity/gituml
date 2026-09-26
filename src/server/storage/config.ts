function readEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export function assertLiveStorageAllowedForTests(service: string): void {
  if (
    process.env.NODE_ENV === "test" &&
    process.env.ALLOW_LIVE_STORAGE_IN_TESTS !== "1"
  ) {
    throw new Error(
      `${service} access is disabled during tests. Mock the storage module or set ALLOW_LIVE_STORAGE_IN_TESTS=1 for an intentional live-storage test.`,
    );
  }
}

export function readRequiredEnv(name: string): string {
  const value = readEnv(name);
  if (!value) {
    throw new Error(`Missing ${name}.`);
  }
  return value;
}
