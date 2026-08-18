import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export interface FakeRuntimeConfig {
  runtimeId?: string;
  host?: string;
  port?: number;
  startupDelayMs?: number;
  healthStatus?: 'ok' | 'degraded';
  identityMode?: 'strong' | 'weak' | 'none';
  portConflict?: boolean;
  failOnStart?: boolean;
  crashAfterMs?: number;
  version?: string;
  profile?: string;
  projectionAvailable?: boolean;
  sessionListAvailable?: boolean;
  /** Set to true to expose the legacy controller surface at a second port (3081-style). */
  controllerEnabled?: boolean;
}

export interface FakeRuntimeAddress {
  baseUrl: string;
  port: number;
  runtimeId: string;
  version: string;
  profile: string;
  processId: number;
  processStartedAt: string;
  commandFingerprint: string;
  bootId: string;
  controllerPort?: number;
  controllerUrl?: string;
}

export interface FakeControllerStatus {
  state: 'running' | 'stopped' | 'starting' | 'stopping' | 'restarting' | 'error';
  running: boolean;
  bootId: string | null;
  pid: number | null;
  uptime: number | null;
  instanceId: string;
}

interface ControllerState {
  state: FakeControllerStatus['state'];
  markers: string[];
}

export class FakeDshRuntime {
  private server: Server | undefined;
  private controllerServer: Server | undefined;
  private crashTimer: NodeJS.Timeout | undefined;
  private bootNumber = 0;
  private startedAt: string | undefined;
  private boundPort: number | undefined;
  private controllerPort: number | undefined;
  private currentBoot: string | undefined;
  private readonly bootIdProvider: () => string;
  private controllerState: ControllerState = { state: 'running', markers: [] };

  readonly config: Required<Pick<FakeRuntimeConfig, 'runtimeId' | 'host' | 'startupDelayMs' | 'healthStatus' | 'identityMode' | 'failOnStart' | 'crashAfterMs' | 'version' | 'profile' | 'projectionAvailable' | 'sessionListAvailable' | 'controllerEnabled'>> & { port?: number; portConflict: boolean };

  constructor(config: FakeRuntimeConfig = {}, bootIdProvider?: () => string) {
    this.config = {
      runtimeId: config.runtimeId ?? 'fake-runtime',
      host: config.host ?? '127.0.0.1',
      ...(config.port !== undefined ? { port: config.port } : {}),
      startupDelayMs: config.startupDelayMs ?? 0,
      healthStatus: config.healthStatus ?? 'ok',
      identityMode: config.identityMode ?? 'strong',
      portConflict: config.portConflict ?? false,
      failOnStart: config.failOnStart ?? false,
      crashAfterMs: config.crashAfterMs ?? 0,
      version: config.version ?? '0.1.0-rc.7',
      profile: config.profile ?? 'web',
      projectionAvailable: config.projectionAvailable ?? false,
      sessionListAvailable: config.sessionListAvailable ?? true,
      controllerEnabled: config.controllerEnabled ?? false
    };
    this.bootIdProvider = bootIdProvider ?? (() => `dsh-fake-${Date.now()}-${this.nextRandom()}`);
  }

  private nextRandom(): string {
    return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
  }

  async start(): Promise<FakeRuntimeAddress> {
    if (this.server) return this.address();
    if (this.config.failOnStart) throw new Error('FAKE_START_FAILED');
    if (this.config.portConflict) {
      const error = new Error('FAKE_PORT_CONFLICT') as NodeJS.ErrnoException;
      error.code = 'EADDRINUSE';
      throw error;
    }
    if (this.config.startupDelayMs > 0) await delay(this.config.startupDelayMs);
    this.bootNumber += 1;
    this.startedAt = new Date().toISOString();
    this.currentBoot = this.bootIdProvider();
    this.server = createServer((request, response) => this.handle(request, response));
    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) return reject(new Error('FAKE_SERVER_MISSING'));
      server.once('error', reject);
      server.listen(this.config.port ?? 0, this.config.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === 'string') throw new Error('FAKE_ADDRESS_MISSING');
    this.boundPort = address.port;

    if (this.config.controllerEnabled) {
      this.controllerServer = createServer((request, response) => this.handleController(request, response));
      await new Promise<void>((resolve, reject) => {
        const server = this.controllerServer;
        if (!server) return reject(new Error('FAKE_CONTROLLER_MISSING'));
        server.once('error', reject);
        server.listen(0, this.config.host, () => {
          server.off('error', reject);
          resolve();
        });
      });
      const controllerAddress = this.controllerServer.address();
      if (!controllerAddress || typeof controllerAddress === 'string') throw new Error('FAKE_CONTROLLER_ADDRESS_MISSING');
      this.controllerPort = controllerAddress.port;
    }

    if (this.config.crashAfterMs > 0) {
      this.crashTimer = setTimeout(() => {
        void this.stop();
      }, this.config.crashAfterMs);
    }
    return this.address();
  }

  async stop(): Promise<void> {
    if (this.crashTimer) clearTimeout(this.crashTimer);
    this.crashTimer = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
    const controllerServer = this.controllerServer;
    this.controllerServer = undefined;
    if (controllerServer) {
      await new Promise<void>((resolve, reject) => controllerServer.close((error) => error ? reject(error) : resolve()));
    }
  }

  /** Simulate an external restart: new boot id, same runtime, fresh process evidence. */
  async externalRestart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  currentBootId(): string {
    return this.currentBoot ?? (this.currentBoot = this.bootIdProvider());
  }

  address(): FakeRuntimeAddress {
    if (!this.boundPort || !this.startedAt) throw new Error('Fake runtime is not started');
    return {
      baseUrl: 'http://' + this.config.host + ':' + this.boundPort,
      port: this.boundPort,
      runtimeId: this.config.runtimeId,
      version: this.config.version,
      profile: this.config.profile,
      processId: process.pid,
      processStartedAt: this.startedAt,
      commandFingerprint: createHash('sha256').update('fake-runtime:' + this.config.runtimeId + ':' + this.bootNumber).digest('hex'),
      bootId: this.currentBootId(),
      ...(this.controllerPort !== undefined ? { controllerPort: this.controllerPort, controllerUrl: 'http://' + this.config.host + ':' + this.controllerPort } : {})
    };
  }

  /** Write a lifecycle marker into the fake controller (restart.requested etc.). */
  async requestLifecycleMarker(action: 'start' | 'stop' | 'restart'): Promise<void> {
    this.controllerState.markers.push(action + '.requested');
    this.controllerState.state = action === 'restart' ? 'restarting' : action === 'stop' ? 'stopping' : 'starting';
  }

  simulateCrash(): void {
    this.controllerState.state = 'stopped';
    void this.stop();
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    const path = request.url?.split('?')[0] ?? '/';
    if (path === '/api/system/health') {
      const health = {
        ok: true,
        ready: this.config.healthStatus === 'ok',
        ...(this.config.identityMode !== 'none' ? { bootId: this.currentBootId() } : {}),
        pid: process.pid,
        uptime: 42,
        ...(this.config.version ? { version: this.config.version } : {}),
        ...(this.config.profile ? { profileId: this.config.profile } : {})
      };
      this.json(response, this.config.healthStatus === 'ok' ? 200 : 503, health);
      return;
    }
    if (path.startsWith('/api/')) {
      // RPC gateway: POST /api/session.list etc.
      if (request.method === 'POST') {
        let body = '';
        request.on('data', (chunk) => { body += chunk; });
        request.on('end', () => {
          const rpc = this.handleRpc(body);
          this.json(response, 200, rpc);
        });
        return;
      }
      this.json(response, 404, { error: 'method-not-allowed' });
      return;
    }
    this.json(response, 200, { ok: true });
  }

  private handleRpc(body: string): unknown {
    let req: { type?: string; rpcId?: string; method?: string };
    try {
      req = JSON.parse(body) as typeof req;
    } catch {
      return { type: 'server-response', rpcId: null, result: { ok: false, error: 'invalid-json' } };
    }
    if (req.type !== 'client-request' || !req.rpcId || !req.method) {
      return { type: 'server-response', rpcId: req.rpcId ?? null, result: { ok: false, error: 'invalid-envelope' } };
    }
    const method = req.method;
    if (method === 'session.list') {
      if (!this.config.sessionListAvailable) {
        return { type: 'server-response', rpcId: req.rpcId, result: { ok: false, error: 'not-supported' } };
      }
      return {
        type: 'server-response',
        rpcId: req.rpcId,
        result: {
          ok: true,
          value: {
            items: [
              {
                sessionId: 'session-fake-' + this.bootNumber,
                updatedAt: Date.now(),
                running: true,
                blank: false,
                cwd: 'C:\\fake'
              }
            ]
          }
        }
      };
    }
    return { type: 'server-response', rpcId: req.rpcId, result: { ok: false, error: 'method-not-found' } };
  }

  private handleController(request: IncomingMessage, response: ServerResponse): void {
    const path = request.url?.split('?')[0] ?? '/';
    if (path === '/api/status') {
      const status: FakeControllerStatus = {
        state: this.controllerState.state,
        running: this.config.healthStatus === 'ok' && this.controllerState.state === 'running',
        bootId: this.config.identityMode === 'none' ? null : this.currentBootId(),
        pid: process.pid,
        uptime: 42,
        instanceId: 'fake-controller-' + this.controllerPort
      };
      this.json(response, 200, status);
      return;
    }
    if (path.startsWith('/api/')) {
      // start/stop/restart marker endpoints
      const action = path.split('/').pop();
      if ((action === 'start' || action === 'stop' || action === 'restart') && request.method === 'POST') {
        this.controllerState.markers.push(action + '.requested');
        this.controllerState.state = action === 'restart' ? 'restarting' : action === 'stop' ? 'stopping' : 'starting';
        this.json(response, 200, { ok: true, id: action + '-' + Date.now() });
        return;
      }
    }
    this.json(response, 404, { ok: false, error: 'not found' });
  }

  private json(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify(body));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}