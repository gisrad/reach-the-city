import type { ComputeRequest, JourneyRequest, RegionBundle } from './reach-types.js';
import { compileBundle, handleCompute, handleJourney } from './routing-engine.js';

type WorkerIncomingMessage =
  | { type: 'loadRegion'; bundle: RegionBundle }
  | ComputeRequest
  | JourneyRequest;

interface WorkerScope {
  onmessage: ((ev: { data: WorkerIncomingMessage }) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
}

const workerScope = globalThis as unknown as WorkerScope;

workerScope.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'loadRegion') {
    compileBundle(msg.bundle);
    workerScope.postMessage({ type: 'regionLoaded', regionId: msg.bundle.id });
    return;
  }

  if (msg.type === 'compute') {
    const res = handleCompute(msg);
    const transfers: Transferable[] = [res.times.buffer];
    if (res.timesA !== res.times) transfers.push(res.timesA.buffer);
    if (res.timesB) transfers.push(res.timesB.buffer);
    workerScope.postMessage(res, transfers);
    return;
  }

  if (msg.type === 'journey') {
    const res = handleJourney(msg);
    workerScope.postMessage(res);
  }
};
