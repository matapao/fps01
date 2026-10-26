/** Numeric gameplay results only. Seat names and identifiers never enter this port. */
export type ReportMetric = (name: string, value: number) => void;
export interface RoundResult {
  readonly kills: readonly number[];
  readonly captures: readonly number[];
}
export class GameMetrics {
  private startedAt: number | null = null;
  private finished = false;
  constructor(privateReport: ReportMetric = () => {}) {
    this.report = privateReport;
  }
  private readonly report: ReportMetric;
  begin(now: number): void {
    if (this.startedAt === null && !this.finished) this.startedAt = now;
  }
  reset(): void {
    this.startedAt = null;
    this.finished = false;
  }
  elimination(): void {
    this.report('eliminations_total', 1);
  }
  capture(): void {
    this.report('captures_total', 1);
  }
  complete(now: number, result: RoundResult): void {
    if (this.finished || this.startedAt === null) return;
    this.finished = true;
    this.report('rounds_total', 1);
    this.report('round_seconds', Math.max(0, now - this.startedAt) / 1000);
    this.report('round_kills', Math.max(0, ...result.kills));
    this.report(
      'round_captures',
      result.captures.reduce((sum, n) => sum + n, 0),
    );
  }
}

/** Reviewed standard arenas only; custom content needs its own declared dimensions. */
export function metricDimensions(mode: string, map: string): Readonly<Record<string, string>> | null {
  if (!['dm', 'ctf'].includes(mode) || !['depot', 'canal', 'fort'].includes(map)) return null;
  return { mode, map };
}
