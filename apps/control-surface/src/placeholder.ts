/**
 * Control Surface — Electron shell (GATED).
 *
 * This package is intentionally a security-posture placeholder until
 * Checkpoint A is accepted and Checkpoint B/C gates are ready
 * (see docs/CHECKPOINTS.md).
 *
 * The design contract for the real shell (frozen by the V1.1 plan):
 *   - `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`
 *   - strict Content-Security-Policy
 *   - IPC allow-list with hello handshake (ControlHelloRequest)
 *   - no arbitrary navigation; renderer never touches fs/process/child_process
 *   - closing the window or quitting Electron leaves Supervisor and DSH running
 *   - no destructive lifecycle/update button is enabled before its gate passes
 *
 * Until the gates pass, `npm run dev` only type-checks this placeholder so the
 * monorepo stays coherent without shipping any privileged Electron surface.
 */

export const SURFACE_GATE = {
  checkpointA: false,
  checkpointB: false,
  checkpointC: false
} as const;

export function surfaceGateStatus(): string {
  const open = (Object.keys(SURFACE_GATE) as Array<keyof typeof SURFACE_GATE>)
    .filter((key) => SURFACE_GATE[key])
    .join(', ');
  return open ? `open: ${open}` : 'all gates closed — surface is a placeholder';
}

console.log('[control-surface]', surfaceGateStatus());