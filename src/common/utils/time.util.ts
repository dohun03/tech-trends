export const delaySeconds = (seconds: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, seconds * 1000));
};

// YYYY-MM-DD — jobId, 캐시 키 등에 공용 사용
export const getTodayDateString = (): string => {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
};

// 오늘 00:00:00의 실제 UTC 시각 — DB mined_at 비교용
export const getTodayStartUtc = (): Date => {
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const now = new Date();
  const kstShifted = new Date(now.getTime() + KST_OFFSET_MS);
  kstShifted.setUTCHours(0, 0, 0, 0);
  return new Date(kstShifted.getTime() - KST_OFFSET_MS);
};