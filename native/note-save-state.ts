export type NativeNoteSaveState = Readonly<Record<string, true>>;

export function nativeNoteSaveKey(userId: string, topicId: string): string {
  return JSON.stringify([userId, topicId]);
}

export function updateNativeNoteSaveState(
  state: NativeNoteSaveState,
  userId: string,
  topicId: string,
  saving: boolean
): NativeNoteSaveState {
  const key = nativeNoteSaveKey(userId, topicId);
  const next: Record<string, true> = { ...state };

  if (saving) {
    next[key] = true;
  } else {
    delete next[key];
  }

  return next;
}
