/**
 * WIP: not wired to the manifest. Do not use as an authorization boundary.
 * Cache provenance across reloads, session invalidation, an authoritative
 * cross-document write fence, transport proof binding, and actual React commit
 * acknowledgement remain unresolved.
 *
 * Coordinates a single, abortable live manifest read. The caller owns the
 * cached view and the durable offline event queue; this controller never
 * writes or replaces that queue.
 *
 * A view is one coherent projection (including its counts, print data and
 * causal controls), not an independently refreshed list of names.
 */
export type LiveManifestScope = {
  shopId: string;
  tripId: string;
  checkpoint: string;
  sessionId: string;
};

function scopeKey(scope: LiveManifestScope): string {
  const values = [scope.shopId, scope.tripId, scope.checkpoint, scope.sessionId];
  return values.every((value) => typeof value === "string" && value.length > 0)
    ? JSON.stringify(values)
    : "";
}

function tripKey(scope: LiveManifestScope): string {
  return JSON.stringify([scope.shopId, scope.tripId]);
}

export type LiveManifestRead<T> = {
  view: T;
  /** Opaque identity for the authenticated session which produced the view. */
  scope: LiveManifestScope;
  /** A server proof bound to this response and the requested nonce. */
  proof: string;
  nonce: string;
};

export type LiveManifestState<T> = {
  view: T | null;
  status: "unconfirmed" | "checking" | "confirmed";
  /** Present only while the verified replacement waits for its UI commit. */
  commitId: number | null;
};

export type LiveManifestTransport<T> = {
  // Expected network failures must return "unavailable". Unexpected throws
  // fail closed because they may conceal an authorization or erasure refusal.
  read: (
    nonce: string,
    signal: AbortSignal,
  ) => Promise<
    | { kind: "ready"; read: LiveManifestRead<T> }
    | { kind: "unavailable" | "unauthorized" | "possible-erasure" }
  >;
  // Verify the current live session and a proof bound to the exact projection,
  // nonce, trip, shop, session, response identity and erasure epoch.
  verify: (
    read: LiveManifestRead<T>,
    signal: AbortSignal,
  ) => Promise<"verified" | "unavailable" | "unauthorized" | "possible-erasure">;
  nonce: () => string;
};

const READ_TIMEOUT_MS = 10_000;
const FRESH_MS = 5 * 60_000;

// Writes can outlive a route owner. Keep only a non-sensitive trip key and a
// count in the document, so a later owner cannot confirm a pre-write read.
const pendingWrites = new Map<string, number>();
const writeListeners = new Map<string, Set<(started: boolean) => void>>();
const staleListeners = new Map<string, Set<() => void>>();
const shopPrivacyGenerations = new Map<string, number>();
const privacyListeners = new Map<string, Set<(cause: "erasure" | "purge") => void>>();
const sessionGenerations = new Map<string, number>();
const sessionListeners = new Map<string, Set<() => void>>();
const invalidatedSessions = new Set<string>();

/** A cached projection must retain the generation captured when it was read. */
export function manifestPrivacyGeneration(shopId: string): number {
  return shopPrivacyGenerations.get(shopId) ?? 0;
}

/** A cached projection must also retain its originating session generation. */
export function manifestSessionGeneration(sessionId: string): number {
  return sessionGenerations.get(sessionId) ?? 0;
}

/** Signout/replacement may arrive after the initiating owner was disposed. */
export function reportManifestSessionInvalidation(sessionId: string): void {
  if (!sessionId) return;
  invalidatedSessions.add(sessionId);
  sessionGenerations.set(sessionId, manifestSessionGeneration(sessionId) + 1);
  for (const listener of sessionListeners.get(sessionId) ?? []) {
    try {
      listener();
    } catch {
      // A broken consumer cannot leave other owners showing old-session data.
    }
  }
}

function invalidateShopPrivacy(shopId: string, cause: "erasure" | "purge"): void {
  shopPrivacyGenerations.set(shopId, manifestPrivacyGeneration(shopId) + 1);
  for (const listener of privacyListeners.get(shopId) ?? []) {
    try {
      listener(cause);
    } catch {
      // Every owner must be invalidated even if another consumer fails.
    }
  }
}

/** Report a possible erasure against the shop captured when a request began. */
export function reportPossibleManifestErasure(shopId: string): void {
  if (shopId) invalidateShopPrivacy(shopId, "erasure");
}

/** Report a completed device purge even if its originating owner is gone. */
export function reportManifestPurge(shopId: string): void {
  if (shopId) invalidateShopPrivacy(shopId, "purge");
}

function notifyWrite(trip: string, started: boolean): void {
  for (const listener of writeListeners.get(trip) ?? []) {
    try {
      listener(started);
    } catch {
      // One broken consumer must not prevent the other owners being fenced.
    }
  }
}

function notifyStale(trip: string): void {
  for (const listener of staleListeners.get(trip) ?? []) {
    try {
      listener();
    } catch {
      // Every owner must withdraw confirmation even if a consumer fails.
    }
  }
}

/** Report a superseded copy against the trip captured when its claim began. */
export function reportManifestStale(shopId: string, tripId: string): void {
  if (shopId && tripId) notifyStale(JSON.stringify([shopId, tripId]));
}

/** Copy a JSON projection so the payload verified cannot be mutated in place. */
function immutableProjection<T>(view: T): T {
  const seen = new Set<object>();
  const validate = (value: unknown): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object") throw new Error("Invalid manifest projection value");
    if (seen.has(value)) throw new Error("Cyclic manifest projection");
    if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)
      throw new Error("Invalid manifest projection object");
    if (Object.getOwnPropertySymbols(value).length > 0)
      throw new Error("Invalid manifest projection symbol");
    if (Array.isArray(value)) {
      if (Object.keys(value).length !== value.length)
        throw new Error("Invalid manifest projection array");
      for (let index = 0; index < value.length; index++) {
        if (!Object.hasOwn(value, index)) throw new Error("Sparse manifest projection array");
      }
    }
    seen.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (!descriptor.enumerable && !(Array.isArray(value) && key === "length"))
        throw new Error("Invalid manifest projection property");
      if (descriptor.get || descriptor.set) throw new Error("Invalid manifest projection property");
      validate(descriptor.value);
    }
    seen.delete(value);
  };
  validate(view);
  const json = JSON.stringify(view);
  if (json === undefined) throw new Error("Invalid manifest projection");
  const copy: T = JSON.parse(json);
  const freeze = (value: unknown): void => {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  };
  freeze(copy);
  return copy;
}

class ManifestReadTimeout extends Error {}

async function bounded<T>(
  controller: AbortController,
  work: () => Promise<T>,
  observe?: (result: T) => void,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work().then((result) => {
        observe?.(result);
        return result;
      }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new ManifestReadTimeout());
        }, READ_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export class LiveManifestCoordinator<T> {
  private sequence = 0;
  private active: AbortController | null = null;
  private scope: string;
  private shop: string;
  private sessionId: string;
  private privacyGeneration: number;
  private sessionGeneration: number;
  private trip: string;
  private readonly usedNonces = new Set<string>();
  private stopWatchingWrites: (() => void) | null = null;
  private stopWatchingPrivacy: (() => void) | null = null;
  private stopWatchingSession: (() => void) | null = null;
  private stopWatchingStale: (() => void) | null = null;
  private readOwed = false;
  private available = false;
  private disposed = false;
  private staleRetryAvailable = true;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private confirmedAt: number | null = null;
  private candidate: {
    read: LiveManifestRead<T>;
    sequence: number;
    scope: string;
    startedAt: number;
    startedWall: number;
  } | null = null;
  private current: LiveManifestState<T>;
  private readonly redacted: LiveManifestState<T> = Object.freeze({
    view: null,
    status: "unconfirmed",
    commitId: null,
  });
  private committedView: T | null;
  private readonly listeners = new Set<(state: LiveManifestState<T>) => void>();

  constructor(
    scope: LiveManifestScope,
    cached: {
      scope: LiveManifestScope;
      view: T;
      privacyGeneration: number;
      sessionGeneration: number;
    } | null,
    private readonly transport: LiveManifestTransport<T>,
  ) {
    this.scope = scopeKey(scope);
    this.shop = scope.shopId;
    this.sessionId = scope.sessionId;
    this.privacyGeneration = manifestPrivacyGeneration(this.shop);
    this.sessionGeneration = manifestSessionGeneration(this.sessionId);
    this.trip = tripKey(scope);
    let view: T | null = null;
    if (
      this.scope &&
      cached &&
      !invalidatedSessions.has(this.sessionId) &&
      scopeKey(cached.scope) === this.scope &&
      cached.privacyGeneration === manifestPrivacyGeneration(this.shop) &&
      cached.sessionGeneration === manifestSessionGeneration(this.sessionId)
    ) {
      try {
        view = immutableProjection(cached.view);
      } catch {
        // An invalid cached projection is never shown as another identity's data.
      }
    }
    this.committedView = view;
    this.current = Object.freeze({ view, status: "unconfirmed", commitId: null });
  }

  get state(): LiveManifestState<T> {
    // A concurrent React render may have constructed this owner before a
    // shop/session invalidation and not activated its subscriptions yet.
    if (
      this.privacyGeneration !== manifestPrivacyGeneration(this.shop) ||
      this.sessionGeneration !== manifestSessionGeneration(this.sessionId) ||
      invalidatedSessions.has(this.sessionId)
    )
      return this.redacted;
    return this.current;
  }

  subscribe(listener: (state: LiveManifestState<T>) => void): () => void {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private publish(state: LiveManifestState<T>): void {
    this.current = Object.freeze(state);
    for (const listener of this.listeners) {
      try {
        listener(this.current);
      } catch {
        // Other consumers must still receive a safety invalidation.
      }
    }
  }

  /** Attach only after a UI commit; an abandoned render must not retain data. */
  activate(): void {
    if (this.disposed) return;
    if (this.privacyGeneration !== manifestPrivacyGeneration(this.shop)) {
      this.privacyGeneration = manifestPrivacyGeneration(this.shop);
      this.invalidate(true);
    }
    if (this.sessionGeneration !== manifestSessionGeneration(this.sessionId)) {
      this.sessionGeneration = manifestSessionGeneration(this.sessionId);
      this.invalidate(true);
    }
    if (!this.stopWatchingWrites) this.watchWrites();
    if (!this.stopWatchingPrivacy) this.watchPrivacy();
    if (!this.stopWatchingSession) this.watchSession();
    if (!this.stopWatchingStale) this.watchStale();
    this.available = true;
  }

  private watchSession(): void {
    this.stopWatchingSession?.();
    const sessionId = this.sessionId;
    const listeners = sessionListeners.get(sessionId) ?? new Set();
    const listener = () => {
      if (this.sessionId === sessionId) {
        this.sessionGeneration = manifestSessionGeneration(sessionId);
        this.readOwed = false;
        this.invalidate(true);
      }
    };
    listeners.add(listener);
    sessionListeners.set(sessionId, listeners);
    this.stopWatchingSession = () => {
      listeners.delete(listener);
      if (listeners.size === 0) sessionListeners.delete(sessionId);
    };
  }

  private watchStale(): void {
    this.stopWatchingStale?.();
    const trip = this.trip;
    const listeners = staleListeners.get(trip) ?? new Set();
    const listener = () => {
      if (this.trip === trip) {
        this.invalidate(false);
        this.queueStaleRead();
      }
    };
    listeners.add(listener);
    staleListeners.set(trip, listeners);
    this.stopWatchingStale = () => {
      listeners.delete(listener);
      if (listeners.size === 0) staleListeners.delete(trip);
    };
  }

  private watchPrivacy(): void {
    this.stopWatchingPrivacy?.();
    const shop = this.shop;
    const listeners = privacyListeners.get(shop) ?? new Set();
    const listener = (cause: "erasure" | "purge") => {
      if (this.shop === shop) {
        this.privacyGeneration = manifestPrivacyGeneration(shop);
        this.invalidate(true);
        if (cause === "erasure") this.queueStaleRead();
        else this.readOwed = false;
      }
    };
    listeners.add(listener);
    privacyListeners.set(shop, listeners);
    this.stopWatchingPrivacy = () => {
      listeners.delete(listener);
      if (listeners.size === 0) privacyListeners.delete(shop);
    };
  }

  private watchWrites(): void {
    this.stopWatchingWrites?.();
    const trip = this.trip;
    const listeners = writeListeners.get(trip) ?? new Set();
    const listener = (started: boolean) => {
      if (this.trip !== trip) return;
      if (started) {
        this.readOwed = true;
        this.invalidate(false);
      } else if (!pendingWrites.has(trip) && this.readOwed && this.available && this.scope) {
        void this.read();
      }
    };
    listeners.add(listener);
    writeListeners.set(trip, listeners);
    this.stopWatchingWrites = () => {
      listeners.delete(listener);
      if (listeners.size === 0) writeListeners.delete(trip);
    };
  }

  /** Every 409 withdraws confirmation; a possible erasure also hides the view. */
  invalidate(possibleErasure: boolean): void {
    const retained = this.current.commitId === null ? this.current.view : this.committedView;
    this.sequence++;
    this.active?.abort();
    this.active = null;
    this.candidate = null;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    this.confirmedAt = null;
    if (possibleErasure) this.committedView = null;
    this.publish({
      view: possibleErasure ? null : retained,
      status: "unconfirmed",
      commitId: null,
    });
  }

  /** A new identity must never inherit the previous identity's cached view. */
  changeScope(scope: LiveManifestScope): void {
    if (this.disposed) return;
    const next = scopeKey(scope);
    if (next === this.scope) return;
    const nextTrip = tripKey(scope);
    this.scope = next;
    this.shop = scope.shopId;
    this.sessionId = scope.sessionId;
    this.privacyGeneration = manifestPrivacyGeneration(this.shop);
    this.sessionGeneration = manifestSessionGeneration(this.sessionId);
    this.trip = nextTrip;
    if (this.stopWatchingWrites) this.watchWrites();
    if (this.stopWatchingPrivacy) this.watchPrivacy();
    if (this.stopWatchingSession) this.watchSession();
    if (this.stopWatchingStale) this.watchStale();
    this.readOwed = false;
    this.staleRetryAvailable = true;
    this.invalidate(true);
  }

  /** Stop work on hide or offline while retaining the last available view. */
  interrupt(): void {
    if (this.disposed) return;
    this.available = false;
    this.invalidate(false);
  }

  /** Dispose the owner without dropping any still-pending write barrier. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.available = false;
    this.readOwed = false;
    this.stopWatchingWrites?.();
    this.stopWatchingWrites = null;
    this.stopWatchingPrivacy?.();
    this.stopWatchingPrivacy = null;
    this.stopWatchingSession?.();
    this.stopWatchingSession = null;
    this.stopWatchingStale?.();
    this.stopWatchingStale = null;
    this.invalidate(true);
    this.listeners.clear();
  }

  async resume(): Promise<void> {
    if (this.disposed) return;
    this.activate();
    this.staleRetryAvailable = true;
    await this.refresh();
  }

  /** Request a fresh read; simultaneous lifecycle signals share active work. */
  async refresh(): Promise<void> {
    if (this.disposed) return;
    if (!this.available || this.active || this.current.commitId !== null) return;
    if (this.current.status === "confirmed") this.invalidate(false);
    await this.read();
  }

  /** A device purge is a privacy boundary even if the session is unchanged. */
  purge(): void {
    if (this.disposed) return;
    // A same-scope server write can still complete after device data is
    // purged. Keep its barrier so a read cannot confirm the pre-write view.
    this.readOwed = false;
    this.staleRetryAvailable = true;
    reportManifestPurge(this.shop);
    // An owner not yet activated has no subscription but must still hide.
    if (!this.stopWatchingPrivacy) this.invalidate(true);
  }

  /** One immediate reread per stale sequence; a later resume may retry. */
  stale(possibleErasure: boolean): void {
    if (this.disposed) return;
    if (possibleErasure) {
      reportPossibleManifestErasure(this.shop);
      if (!this.stopWatchingPrivacy) {
        this.invalidate(true);
        this.queueStaleRead();
      }
    } else {
      notifyStale(this.trip);
      if (!this.stopWatchingStale) {
        this.invalidate(false);
        this.queueStaleRead();
      }
    }
  }

  private queueStaleRead(): void {
    this.readOwed = true;
    if (!this.staleRetryAvailable) return;
    this.staleRetryAvailable = false;
    if (this.available && !pendingWrites.has(this.trip) && this.scope) void this.read();
  }

  /** Call on visibility/focus changes as well as relying on the expiry timer. */
  recheckFreshness(now = Date.now()): void {
    if (
      this.current.status === "confirmed" &&
      (this.confirmedAt === null ||
        !Number.isFinite(now) ||
        now < this.confirmedAt ||
        now - this.confirmedAt >= FRESH_MS)
    )
      this.invalidate(false);
  }

  /** An in-flight local write must not be overwritten by an earlier read. */
  beginMutation(): () => void {
    if (this.disposed) throw new Error("Cannot start a write from a disposed manifest owner");
    if (!this.stopWatchingWrites) throw new Error("Cannot start a write before activation");
    const trip = this.trip;
    pendingWrites.set(trip, (pendingWrites.get(trip) ?? 0) + 1);
    notifyWrite(trip, true);
    let settled = false;
    return () => {
      if (settled) return;
      settled = true;
      const remaining = (pendingWrites.get(trip) ?? 1) - 1;
      if (remaining > 0) pendingWrites.set(trip, remaining);
      else pendingWrites.delete(trip);
      notifyWrite(trip, false);
    };
  }

  async read(): Promise<void> {
    if (this.disposed) return;
    if (!this.available || !this.scope || invalidatedSessions.has(this.sessionId)) return;
    if (pendingWrites.has(this.trip)) {
      this.readOwed = true;
      return;
    }
    if (this.active || this.current.commitId !== null || this.current.status === "confirmed")
      return;
    this.readOwed = false;
    const sequence = ++this.sequence;
    this.candidate = null;
    if (this.expiry) clearTimeout(this.expiry);
    this.expiry = null;
    this.confirmedAt = null;
    const controller = new AbortController();
    this.active = controller;
    const scope = this.scope;
    const shopId = this.shop;
    const sessionId = this.sessionId;
    const startedAt = performance.now();
    const startedWall = Date.now();
    this.publish({ ...this.current, status: "checking", commitId: null });
    try {
      let nonce: string;
      try {
        if (!Number.isFinite(startedAt) || !Number.isFinite(startedWall))
          throw new Error("Invalid manifest read clock");
        nonce = this.transport.nonce();
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(nonce) ||
          this.usedNonces.has(nonce.toLowerCase())
        )
          throw new Error("Invalid or reused manifest read nonce");
        this.usedNonces.add(nonce.toLowerCase());
      } catch {
        // A local inability to start the read is not an identity transition.
        this.publish({ ...this.current, status: "unconfirmed", commitId: null });
        return;
      }
      if (
        controller.signal.aborted ||
        sequence !== this.sequence ||
        scope !== this.scope ||
        invalidatedSessions.has(sessionId)
      )
        return;
      // A definitive privacy refusal belongs to the scope captured by the
      // request, even after timeout, hiding, or disposal. Late success is ignored.
      const observeRefusal = (result: "possible-erasure" | "unauthorized" | string) => {
        if (result === "possible-erasure") reportPossibleManifestErasure(shopId);
        else if (result === "unauthorized") reportManifestSessionInvalidation(sessionId);
      };
      const outcome = await bounded(
        controller,
        () => this.transport.read(nonce, controller.signal),
        (result) => observeRefusal(result.kind),
      );
      if (
        controller.signal.aborted ||
        sequence !== this.sequence ||
        scope !== this.scope ||
        invalidatedSessions.has(sessionId)
      )
        return;
      if (outcome.kind !== "ready") {
        this.invalidate(outcome.kind !== "unavailable");
        return;
      }
      const result = Object.freeze({
        ...outcome.read,
        scope: Object.freeze({ ...outcome.read.scope }),
        view: immutableProjection(outcome.read.view),
      });
      if (result.nonce !== nonce) {
        this.invalidate(false);
        return;
      }
      if (scopeKey(result.scope) !== scope) {
        if (
          result.scope.sessionId !== sessionId &&
          scopeKey({ ...result.scope, sessionId }) === scope
        ) {
          // A response is not authoritative until the current-cookie proof
          // validates it. A malformed response must not tombstone peers.
          await bounded(
            controller,
            () => this.transport.verify(result, controller.signal),
            (verification) => {
              if (verification === "verified") reportManifestSessionInvalidation(sessionId);
              else observeRefusal(verification);
            },
          );
        }
        if (sequence === this.sequence && scope === this.scope) this.invalidate(true);
        return;
      }
      const verified = await bounded(
        controller,
        () => this.transport.verify(result, controller.signal),
        observeRefusal,
      );
      if (
        controller.signal.aborted ||
        sequence !== this.sequence ||
        scope !== this.scope ||
        invalidatedSessions.has(sessionId)
      )
        return;
      if (verified !== "verified") {
        this.invalidate(verified !== "unavailable");
        return;
      }
      if (pendingWrites.has(this.trip)) {
        this.readOwed = true;
        this.invalidate(false);
        return;
      }
      // This is not yet confirmation: React must acknowledge that this exact
      // coherent projection is visible before the status can say checked.
      this.candidate = { read: result, sequence, scope, startedAt, startedWall };
      this.publish({ view: result.view, status: "unconfirmed", commitId: sequence });
    } catch (error) {
      if (sequence === this.sequence && this.active === controller) {
        if (error instanceof ManifestReadTimeout)
          this.publish({ ...this.current, status: "unconfirmed", commitId: null });
        else this.invalidate(true);
      }
    } finally {
      if (this.active === controller) this.active = null;
    }
  }

  async acknowledgeCommit(commitId: number): Promise<void> {
    if (this.disposed) return;
    if (invalidatedSessions.has(this.sessionId)) return;
    const candidate = this.candidate;
    if (!candidate || commitId !== this.sequence || commitId !== this.current.commitId) return;
    const age = () => {
      const monotonic = performance.now() - candidate.startedAt;
      const wall = Date.now() - candidate.startedWall;
      return Number.isFinite(monotonic) && Number.isFinite(wall) && monotonic >= 0 && wall >= 0
        ? Math.max(monotonic, wall)
        : Number.POSITIVE_INFINITY;
    };
    // The owner acknowledges only from the visible subtree's commit. From
    // this point a non-privacy interruption must retain this view rather than
    // resurrect an older roster that may contain an erased person.
    this.committedView = this.current.view;
    if (age() >= FRESH_MS) {
      this.invalidate(false);
      return;
    }
    this.candidate = null;
    const controller = new AbortController();
    this.active = controller;
    try {
      // Recheck the current session and erasure fence after the UI commits.
      // This is a recent check, not a promise of continuous validity.
      const verified = await bounded(
        controller,
        () => this.transport.verify(candidate.read, controller.signal),
        (result) => {
          if (result === "possible-erasure")
            reportPossibleManifestErasure(candidate.read.scope.shopId);
          else if (result === "unauthorized")
            reportManifestSessionInvalidation(candidate.read.scope.sessionId);
        },
      );
      if (
        controller.signal.aborted ||
        candidate.sequence !== this.sequence ||
        candidate.scope !== this.scope ||
        invalidatedSessions.has(candidate.read.scope.sessionId)
      )
        return;
      if (verified !== "verified") {
        this.invalidate(verified !== "unavailable");
        return;
      }
      if (pendingWrites.has(this.trip)) {
        this.readOwed = true;
        this.invalidate(false);
        return;
      }
      const elapsed = age();
      if (elapsed >= FRESH_MS) {
        this.invalidate(false);
        return;
      }
      this.confirmedAt = Date.now() - elapsed;
      if (!Number.isFinite(this.confirmedAt)) {
        this.invalidate(false);
        return;
      }
      this.committedView = this.current.view;
      this.publish({ ...this.current, status: "confirmed", commitId: null });
      if (candidate.sequence === this.sequence) {
        this.staleRetryAvailable = true;
        this.expiry = setTimeout(() => {
          if (candidate.sequence === this.sequence) this.invalidate(false);
        }, FRESH_MS - elapsed);
      }
    } catch (error) {
      if (candidate.sequence === this.sequence && this.active === controller) {
        if (error instanceof ManifestReadTimeout)
          this.publish({ ...this.current, status: "unconfirmed", commitId: null });
        else this.invalidate(true);
      }
    } finally {
      if (this.active === controller) this.active = null;
    }
  }
}
