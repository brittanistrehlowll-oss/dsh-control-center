import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ServerResponse } from 'node:http';
import {
  buildSummary,
  diagnose,
  type DiagnosticContext
} from '@dsh-control-center/diagnostics';
import type { EventBus, Supervisor } from '@dsh-control-center/supervisor-core';

/**
 * surface.ts — serve the read-only monitoring web page + status API.
 *
 *   GET /            → surface.html (the dashboard)
 *   GET /api/status  → { supervisor, runtime, diagnostics, quota, events }
 *   GET /events      → SSE (wired in index.ts)
 *
 * Read-only: no lifecycle buttons here (destructive actions stay gated behind
 * Checkpoint A/B/C in the real control-surface).
 */

let cachedHtml: string | undefined;

export async function surfaceHtml(): Promise<string> {
  if (cachedHtml === undefined) {
    cachedHtml = await readFile(join(import.meta.dirname, '..', 'assets', 'surface.html'), 'utf8');
  }
  return cachedHtml;
}

export interface SurfaceStatus {
  supervisor: string;
  runtime: {
    reachable: boolean | undefined;
    protocolValid: boolean | undefined;
    state: string | undefined;
    ready: boolean | undefined;
    bootId: string | undefined;
    pid: number | undefined;
    identityStrength: string | undefined;
    identityValue: string | undefined;
    ownership: string | undefined;
    dshVersion: string | undefined;
    sessions: number | undefined;
    controllerState: string | undefined;
    updateSourceVerified: boolean | undefined;
    installAuthority: string | undefined;
  };
  diagnostics: {
    generatedAt: string;
    items: unknown[];
    counts: { pass: number; warn: number; fail: number; unknown: number };
  };
  quota: unknown[];
  events: unknown[];
}

export async function buildSurfaceStatus(args: {
  supervisor: Supervisor;
  eventBus: EventBus;
  dshVersion?: string;
  controllerState?: string;
  updateSourceVerified?: boolean;
  installAuthority?: string;
}): Promise<SurfaceStatus> {
  const probe = args.supervisor.lastKnownProbe();
  const eventBus = args.eventBus;

  const dctx: DiagnosticContext = {
    supervisorAlive: true,
    supervisorInstanceId: args.supervisor.instanceId,
    ipcListening: false,
    dshReachable: probe?.reachable ?? false,
    dshReady: probe?.health?.ready ?? false,
    ...(args.dshVersion ? { dshVersion: args.dshVersion } : {}),
    identityStrength: probe?.identity.strength ?? 'none',
    ownershipKnown: probe?.descriptor?.ownership !== undefined,
    watchdogResponding: probe?.controller !== undefined,
    ...(args.controllerState ? { watchdogState: args.controllerState } : {}),
    port3080Open: probe?.reachable ?? false,
    port3081Open: probe?.controller !== undefined,
    updateSourceVerified: args.updateSourceVerified ?? false,
    snapshotUsable: false,
    journalHealthy: true,
    permissionsOkay: true
  };
  const diagItems = diagnose(dctx);
  const summary = buildSummary(diagItems);

  const recentEvents = eventBus.allHistory().slice(-12);

  return {
    supervisor: args.supervisor.instanceId,
    runtime: {
      reachable: probe?.reachable,
      protocolValid: probe?.protocolValid,
      state: probe?.health?.ready ? 'running' : probe?.reachable ? 'starting' : 'stopped',
      ready: probe?.health?.ready,
      bootId: probe?.health?.bootId,
      pid: probe?.health?.pid,
      identityStrength: probe?.identity.strength,
      identityValue: probe?.identity.value,
      ownership: probe?.descriptor?.ownership,
      dshVersion: args.dshVersion,
      sessions: undefined,
      controllerState: args.controllerState,
      updateSourceVerified: args.updateSourceVerified,
      installAuthority: args.installAuthority
    },
    diagnostics: summary,
    quota: [],
    events: recentEvents
  };
}

export function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}