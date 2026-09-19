import { monitorEventLoopDelay } from 'node:perf_hooks';

// -----------------------------------------------------------------------------
// 이벤트 루프 지연(lag) & 메모리(RSS/Heap) 모니터링 유틸
// -----------------------------------------------------------------------------
// - node:perf_hooks 의 monitorEventLoopDelay() 를 사용해 이벤트 루프 지연의
//   mean/p50/p90/p95/p99/max(ms) 를 1초 간격으로 콘솔에 기록
// - process.memoryUsage() 로 RSS / HeapUsed / HeapTotal / External 동시 출력
// - 이벤트 루프 lag >= 100ms 또는 힙 사용률 >= 90% 시 [WARN] 경고 로그
// - 환경변수 ENABLE_PERF_LOG=true 일 때만 동작 (부하 테스트/진단 전용)
// -----------------------------------------------------------------------------

const ENABLE_FLAG = 'ENABLE_PERF_LOG';
const SAMPLE_INTERVAL_MS = 1000;
const EVENT_LOOP_WARN_MS = 100;
const HEAP_USAGE_WARN_RATIO = 0.9;

const NS_TO_MS = 1e6;

// monitorEventLoopDelay 히스토그램은 나노초 단위 → 밀리초 변환
function ms(value: number | undefined): number {
  return (value ?? 0) / NS_TO_MS;
}

export function startPerfMonitor(): void {
  if (process.env[ENABLE_FLAG] !== 'true') {
    return;
  }

  const monitor = monitorEventLoopDelay({ resolution: 10 });
  monitor.enable();

  console.log(
    `[PERF] 성능 모니터링 시작 (interval=${SAMPLE_INTERVAL_MS}ms, ` +
      `warnLag=${EVENT_LOOP_WARN_MS}ms, warnHeap=${HEAP_USAGE_WARN_RATIO * 100}%)`,
  );

  const timer = setInterval(() => {
    const lag = {
      mean: ms(monitor.mean),
      p50: ms(monitor.percentile(50)),
      p90: ms(monitor.percentile(90)),
      p95: ms(monitor.percentile(95)),
      p99: ms(monitor.percentile(99)),
      max: ms(monitor.max),
    };

    const { rss, heapUsed, heapTotal, external } = process.memoryUsage();
    const rssMB = rss / 1024 / 1024;
    const heapUsedMB = heapUsed / 1024 / 1024;
    const heapTotalMB = heapTotal / 1024 / 1024;
    const externalMB = external / 1024 / 1024;
    const heapRatio = heapTotal > 0 ? heapUsed / heapTotal : 0;

    console.log(
      `[PERF] EL lag(ms) mean=${lag.mean.toFixed(2)} p50=${lag.p50.toFixed(2)} ` +
        `p90=${lag.p90.toFixed(2)} p95=${lag.p95.toFixed(2)} p99=${lag.p99.toFixed(2)} ` +
        `max=${lag.max.toFixed(2)} | RSS=${rssMB.toFixed(1)}MB ` +
        `Heap=${heapUsedMB.toFixed(1)}/${heapTotalMB.toFixed(1)}MB ` +
        `External=${externalMB.toFixed(1)}MB`,
    );

    if (lag.max >= EVENT_LOOP_WARN_MS) {
      console.warn(
        `[WARN] Event Loop Stalled: ${lag.max.toFixed(1)}ms ` +
          `(p95=${lag.p95.toFixed(1)}ms, p99=${lag.p99.toFixed(1)}ms)`,
      );
    }

    if (heapRatio >= HEAP_USAGE_WARN_RATIO) {
      console.warn(
        `[WARN] Heap Usage High: ${(heapRatio * 100).toFixed(1)}% ` +
          `(HeapUsed=${heapUsedMB.toFixed(1)}MB / HeapTotal=${heapTotalMB.toFixed(1)}MB)`,
      );
    }

    // 지난 샘플 구간(1초)만 집계하도록 히스토그램 리셋
    monitor.reset();
  }, SAMPLE_INTERVAL_MS);

  // HTTP 서버 등이 프로세스를 유지하므로, 이 타이머가 단독으로 프로세스를 붙잡지 않게 한다.
  timer.unref();
}