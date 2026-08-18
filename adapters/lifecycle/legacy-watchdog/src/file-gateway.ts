import { access, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redactLogLine } from '@dsh-control-center/security';
import type { LifecycleGateway } from './index.js';

/**
 * FileGateway — the concrete legacy lifecycle gateway.
 *
 * ALL legacy implementation details live here (ADR-004):
 *   - DSH root discovery and the logs/ dir with marker files
 *   - 127.0.0.1:3081 controller status read
 *   - marker names: restart.requested / stop.requested / start.requested
 *
 * This module must never be imported by packages other than the adapter.
 * It performs NO process control; it only writes marker intents that an
 * external watchdog consumes.
 */

export const LEGACY_DSH_PORT = 3080;
export const LEGACY_CONTROLLER_PORT = 3081;
export const MARKER_NAMES = {
  start: 'start.requested',
  stop: 'stop.requested',
  restart: 'restart.requested'
} as const;

export interface FileGatewayOptions {
  dshLogsDir: string;
  controllerUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBodyBytes?: number;
}

export class FileGateway implements LifecycleGateway {
  private readonly dshLogsDir: string;
  private readonly controllerUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxBodyBytes: number;

  constructor(options: FileGatewayOptions) {
    this.dshLogsDir = options.dshLogsDir;
    this.controllerUrl = options.controllerUrl ?? `http://127.0.0.1:${LEGACY_CONTROLLER_PORT}`;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 2_000;
    this.maxBodyBytes = options.maxBodyBytes ?? 16 * 1024;
  }

  async writeMarker(action: 'start' | 'stop' | 'restart'): Promise<{ ok: boolean; id: string }> {
    const marker = MARKER_NAMES[action];
    const filePath = join(this.dshLogsDir, marker);
    const id = `${action}_${Date.now()}`;
    const content = `${action}Id=${id} requested by dsh-control-center at ${new Date().toISOString()}\n`;
    await writeFile(filePath, content, 'utf8');
    return { ok: true, id };
  }

  async markerExists(action: 'start' | 'stop' | 'restart'): Promise<boolean> {
    try {
      await access(join(this.dshLogsDir, MARKER_NAMES[action]));
      return true;
    } catch {
      return false;
    }
  }

  async readControllerStatus(): Promise<{ state: string; bootId?: string; pid?: number; instanceId?: string } | undefined> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.controllerUrl}/api/status`, {
        method: 'GET',
        headers: { accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) return undefined;
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > this.maxBodyBytes) return undefined;
      let body: Record<string, unknown>;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(buffer)) as unknown;
        if (typeof parsed !== 'object' || parsed === null) return undefined;
        body = parsed as Record<string, unknown>;
      } catch {
        return undefined;
      }
      if (typeof body.state !== 'string') return undefined;
      return {
        state: body.state,
        ...(typeof body.bootId === 'string' ? { bootId: body.bootId } : {}),
        ...(typeof body.pid === 'number' ? { pid: body.pid } : {}),
        ...(typeof body.instanceId === 'string' ? { instanceId: body.instanceId } : {})
      };
    } catch (error) {
      console.warn('[legacy-watchdog] controller status unavailable:', redactLogLine(String(error)));
      return undefined;
    } finally {
      clearTimeout(timer);
    }
  }
}