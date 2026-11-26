import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { beforeEach, describe, it } from 'node:test';
import {
  UNREACHABLE_MIN,
  clearCompiledRegions,
  compileBundle,
  handleCompute,
  handleJourney,
  type RegionBundle,
} from '../src/index.js';

const syntheticUrl = new URL('../../examples/synthetic-metro.json', import.meta.url);
const baseBundle = JSON.parse(await readFile(syntheticUrl, 'utf8')) as RegionBundle;

function cloneBundle(overrides: Partial<RegionBundle> = {}): RegionBundle {
  return {
    ...structuredClone(baseBundle),
    ...overrides,
  };
}

describe('Transbulent Reach multimodal routing engine', () => {
  beforeEach(() => {
    clearCompiledRegions();
  });

  it('models peak vs off-peak transit headway wait penalties', () => {
    const bundle = cloneBundle();
    compileBundle(bundle);

    const peakRes = handleCompute({
      type: 'compute',
      requestId: 1,
      regionId: bundle.id,
      purpose: 'transit',
      travelMode: 'transit',
      departMin: 8 * 60, // 08:00 peak
      maxMinutes: 120,
      originAId: 'hub-central',
    });

    const offPeakRes = handleCompute({
      type: 'compute',
      requestId: 2,
      regionId: bundle.id,
      purpose: 'transit',
      travelMode: 'transit',
      departMin: 12 * 60, // 12:00 off-peak
      maxMinutes: 120,
      originAId: 'hub-central',
    });

    const northIdx = bundle.nodes.findIndex((n) => n.id === 'st-north');
    assert.ok(northIdx >= 0);
    // Rail runMin=10, peak wait=0.5*8=4 (14m) vs off-peak wait=0.5*16=8 (18m)
    assert.equal(Math.round(peakRes.times[northIdx]), 14);
    assert.equal(Math.round(offPeakRes.times[northIdx]), 18);
    assert.ok(peakRes.times[northIdx] < offPeakRes.times[northIdx]);
  });

  it('disables scheduled transit edges outside operating hours', () => {
    const bundle = cloneBundle();
    compileBundle(bundle);

    const nightJourney = handleJourney({
      type: 'journey',
      requestId: 3,
      regionId: bundle.id,
      travelMode: 'transit',
      departMin: 2 * 60, // 02:00 outside 05:00..22:00 window
      originId: 'hub-central',
      destIdx: bundle.nodes.findIndex((n) => n.id === 'st-north'),
    });

    assert.ok(nightJourney.journeyA);
    assert.equal(
      nightJourney.journeyA.legs.some((leg) => leg.mode === 'rail' || leg.mode === 'brt'),
      false,
      'Night transit journey must not board inactive rail/BRT edges'
    );
  });

  it('enforces motorTollAllowed and walk toll exclusion on road edges', () => {
    const restricted = cloneBundle({ motorTollAllowed: false });
    compileBundle(restricted);

    const motorRestricted = handleJourney({
      type: 'journey',
      requestId: 4,
      regionId: restricted.id,
      travelMode: 'motor',
      departMin: 10 * 60,
      originId: 'hub-east',
      destIdx: restricted.nodes.findIndex((n) => n.id === 'air-intl'),
    });
    // Only edge between hub-east (2) and air-intl (9) is a toll road (plus BRT transit), so unreachable by motor when tolls forbidden
    assert.equal(motorRestricted.journeyA, null);

    const walkRes = handleCompute({
      type: 'compute',
      requestId: 5,
      regionId: restricted.id,
      purpose: 'transit',
      travelMode: 'walk',
      departMin: 10 * 60,
      maxMinutes: 120,
      originAId: 'hub-east',
    });
    const airportIdx = restricted.nodes.findIndex((n) => n.id === 'air-intl');
    assert.equal(walkRes.times[airportIdx], UNREACHABLE_MIN);

    clearCompiledRegions();
    const allowed = cloneBundle({ motorTollAllowed: true });
    compileBundle(allowed);
    const motorAllowed = handleJourney({
      type: 'journey',
      requestId: 6,
      regionId: allowed.id,
      travelMode: 'motor',
      departMin: 10 * 60,
      originId: 'hub-east',
      destIdx: allowed.nodes.findIndex((n) => n.id === 'air-intl'),
    });
    assert.ok(motorAllowed.journeyA);
    assert.ok(motorAllowed.journeyA.totalMinutes > 0);
  });

  it('computes dual-anchor commuter sweet spots for minimax and average modes', () => {
    const bundle = cloneBundle();
    compileBundle(bundle);

    const minimaxRes = handleCompute({
      type: 'compute',
      requestId: 7,
      regionId: bundle.id,
      purpose: 'commuter',
      travelMode: 'car',
      departMin: 8 * 60,
      maxMinutes: 120,
      originAId: 'hub-central',
      originBId: 'hub-east',
      combineMode: 'max',
    });

    const avgRes = handleCompute({
      type: 'compute',
      requestId: 8,
      regionId: bundle.id,
      purpose: 'commuter',
      travelMode: 'car',
      departMin: 8 * 60,
      maxMinutes: 120,
      originAId: 'hub-central',
      originBId: 'hub-east',
      combineMode: 'avg',
    });

    assert.ok(minimaxRes.sweetSpots.length > 0);
    const parkIdx = bundle.nodes.findIndex((n) => n.id === 'poi-park');
    assert.ok(parkIdx >= 0);
    assert.equal(
      Math.round(minimaxRes.times[parkIdx]),
      Math.round(Math.max(minimaxRes.timesA[parkIdx], minimaxRes.timesB![parkIdx]))
    );
    assert.equal(
      Math.round(avgRes.times[parkIdx]),
      Math.round(0.5 * (avgRes.timesA[parkIdx] + avgRes.timesB![parkIdx]))
    );
    assert.ok(minimaxRes.sweetSpots[0].combinedTime <= minimaxRes.sweetSpots[minimaxRes.sweetSpots.length - 1].combinedTime);
  });

  it('scores tourist basecamp reachability and compares two candidate origins', () => {
    const bundle = cloneBundle();
    compileBundle(bundle);

    const res = handleCompute({
      type: 'compute',
      requestId: 9,
      regionId: bundle.id,
      purpose: 'tourist',
      travelMode: 'transit',
      departMin: 9 * 60,
      maxMinutes: 120,
      originAId: 'hub-central',
      compareOriginId: 'st-north',
    });

    assert.ok(res.basecampScore);
    assert.ok(res.compareScore);
    assert.equal(res.basecampScore.totalTourists, 3);
    assert.ok(res.basecampScore.within45 >= 1);
    assert.ok(res.basecampScore.airportMinutes !== null && res.basecampScore.airportMinutes > 0);
    assert.ok(res.basecampScore.within45 >= res.compareScore.within45);
  });

  it('seeds multi-source vital access from all target facilities at t = 0', () => {
    const bundle = cloneBundle();
    compileBundle(bundle);

    const res = handleCompute({
      type: 'compute',
      requestId: 10,
      regionId: bundle.id,
      purpose: 'vital',
      travelMode: 'car',
      departMin: 14 * 60,
      maxMinutes: 60,
      originAId: 'hub-central',
      vitalTarget: 'hospital',
    });

    assert.ok(res.vitalStats);
    assert.equal(res.vitalStats.target, 'hospital');
    assert.equal(res.vitalStats.hubCount, 2);
    const hospMainIdx = bundle.nodes.findIndex((n) => n.id === 'hosp-main');
    const hospNorthIdx = bundle.nodes.findIndex((n) => n.id === 'hosp-north');
    assert.equal(res.times[hospMainIdx], 0);
    assert.equal(res.times[hospNorthIdx], 0);
    assert.ok(res.vitalStats.pctUnder30 >= res.vitalStats.pctUnder15);
  });

  it('reconstructs multimodal journeys with transfer count and coordinates', () => {
    const bundle = cloneBundle();
    compileBundle(bundle);

    const res = handleJourney({
      type: 'journey',
      requestId: 11,
      regionId: bundle.id,
      travelMode: 'transit',
      departMin: 8 * 60,
      originId: 'hub-central',
      destIdx: bundle.nodes.findIndex((n) => n.id === 'air-intl'),
    });

    assert.ok(res.journeyA);
    assert.equal(res.journeyA.originName, 'Central Station');
    assert.equal(res.journeyA.destName, 'Metro International Airport');
    assert.equal(res.journeyA.transfers, 1); // rail -> brt transfer at East Exchange
    assert.ok(res.journeyA.legs.length >= 2);
    assert.ok(res.journeyA.coords.length >= 3);
    assert.ok(res.journeyA.totalMinutes > 0);
  });
});
