# Group F — 스킬 동적 게이팅 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 차트 프롬프트가 매번 무조건 주입하던 ~66개 스킬을, 차트 상태(detectSignals 이벤트 + textbook 상태)에 따라 관련 있는 것만 동적으로 선택해 주입한다.

**Architecture:** (1) `detectSignals` 카탈로그를 양방향 대칭화. (2) 순수 domain 함수 `selectSkills`가 frontmatter 게이팅 메타 + 차트 features로 Tier-1/2 스킬을 고른다(Tier-0는 always-on). (3) `buildAnalysisPrompt`가 그 결과만 주입. (4) 캐시 fingerprint·검증 CI·fail-open 가드레일.

**Tech Stack:** TypeScript(순수 domain), Vitest(90% branch), 멀티레포(siglens-core 라이브러리 + siglens consumer), gemini batch(검증).

**참조 spec:** `docs/superpowers/specs/2026-06-01-group-f-skill-gating-design.md`

**전제:** siglens-core는 worktree에서 작업(`superpowers:using-git-worktrees`). 버전업 금지(package.json 0.x 유지, release-it는 사용자 소유). 커밋 footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

## 파일 구조 (무엇을 만들고 고치나)

**siglens-core (PR1·PR2):**
- `src/domain/signals/confirmed.ts` — bearish 짝 9개 detector 추가 + mfi fix (PR1)
- `src/domain/signals/constants.ts` — bearish 임계값 상수 (PR1)
- `src/domain/signals/index.ts` — `detectSignals`에 새 detector 등록 (PR1)
- `src/domain/types.ts` — `Signal` kind union 확장, `SkillGating` frontmatter 타입, `SkillSelectionContext` (PR1·PR2)
- `src/domain/analysis/selectSkills.ts` — **신규**, 순수 게이팅 함수 (PR2)
- `src/domain/analysis/skillGatingPredicates.ts` — **신규**, textbook state 술어 (PR2)
- `src/domain/analysis/prompt.ts` — `buildAnalysisPrompt`가 `selectSkills` 사용 (PR2)
- `src/infrastructure/skills/loader.ts` — frontmatter 신규 필드 파싱 + name dedup (PR2)
- `src/infrastructure/cache/*` 또는 config — 차트 캐시 키에 skill fingerprint fold (PR2)
- 테스트: `src/__tests__/domain/signals/`, `src/__tests__/domain/analysis/selectSkills.test.ts` 등

**siglens (PR3):**
- `skills/**/*.md` — 67개 frontmatter에 `gating` 블록 추가
- `skills/_core/indicator-core.md`, `skills/_core/candle-primer.md` — **신규** 압축 코어
- `scripts/validate-skills.ts` — **신규** 검증 CI 스크립트
- `src/entities/skill/api.ts` — 파서를 core와 통일(또는 core 로더 재사용)
- `.github/workflows/ci.yml` — validate-skills 게이트 추가
- `scripts/backtests/generate-backtest.ts` — skills 게이팅 주입 (검증 Phase)

---

# PR1 — detectSignals 양방향 대칭화 + mfi fix (siglens-core)

독립 PR. 게이팅의 기반(이벤트 카탈로그)을 상승·하락 대칭으로 만든다. v3 측정: 하락장 FN −23%, precision↑, 회귀 0.

### Task 1.1: `Signal` kind union에 bearish 타입 9개 추가

**Files:**
- Modify: `src/domain/types.ts` (`Signal['type']` union)
- Test: `src/__tests__/domain/types-signal.test.ts` (타입 레벨 — tsc로 검증)

- [ ] **Step 1: union에 9개 추가**

`src/domain/types.ts`의 `Signal` 타입(또는 `ConfirmedSignalType` union)에 추가:
```ts
// 기존 bullish 옆에 bearish 짝 추가
| 'keltner_lower_breakout'
| 'supertrend_bearish_flip'
| 'ichimoku_cloud_breakdown'
| 'cci_bearish_cross'
| 'dmi_bearish_cross'
| 'cmf_bearish_flip'
| 'mfi_overbought_reversal'
| 'parabolic_sar_bearish_flip'
| 'squeeze_momentum_bearish'
```

- [ ] **Step 2: typecheck** — `yarn typecheck` → 새 union 멤버가 detector 반환 타입과 아직 불일치해도 이 단계는 타입 선언만이라 통과해야 함. Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add src/domain/types.ts
git commit -m "feat(signals): add bearish signal kinds to Signal union"
```

### Task 1.2: bearish 임계값 상수

**Files:**
- Modify: `src/domain/signals/constants.ts`

- [ ] **Step 1: 상수 추가** (기존 bullish 상수 재사용 가능한 건 재사용; 신규만)
```ts
/** CCI가 위에서 아래로 통과하면 bearish — 과매수 이탈. */
export const CCI_OVERBOUGHT_CROSS_LEVEL = 100;
export const CCI_BEARISH_CROSS_LEVEL = 0;
/** CMF 0 하향 돌파 = 분산. */
export const CMF_BEARISH_CROSS_LEVEL = 0;
/** MFI 과매수 = 80 (oversold 20의 짝). */
export const MFI_OVERBOUGHT_LEVEL = 80;
/** squeeze momentum 0 하향. */
// SQUEEZE_MOMENTUM_ZERO_CROSS 재사용 (방향만 down)
```
(DMI bearish는 `DMI_ADX_TREND_THRESHOLD` 재사용. keltner/ichimoku/supertrend/sar는 임계값 없이 채널·trend로 판정.)

- [ ] **Step 2: Commit**
```bash
git add src/domain/signals/constants.ts
git commit -m "feat(signals): add bearish threshold constants"
```

### Task 1.3: bearish detector 9개 (TDD)

각 detector는 `confirmed.ts`의 bullish 짝을 **반대 방향 미러**. 아래는 keltner_lower_breakout의 **완전 예시**; 나머지 8개는 동일 패턴(짝 함수의 부등호/방향 반전)으로 §매핑표를 따라 구현한다.

**Files:**
- Modify: `src/domain/signals/confirmed.ts`
- Test: `src/__tests__/domain/signals/confirmed-bearish.test.ts`

- [ ] **Step 1: keltner_lower_breakout 실패 테스트**
```ts
import { describe, it, expect } from 'vitest';
import { detectKeltnerLowerBreakout } from '@/domain/signals/confirmed';
import { calculateIndicators } from '@/domain/indicators';
import type { Bar } from '@/domain/types';

describe('detectKeltnerLowerBreakout', () => {
  it('fires when close breaks below lower keltner channel', () => {
    // 하단을 종가가 막 하향 돌파하는 봉 시퀀스 구성
    const bars: Bar[] = makeDowntrendBarsBreakingLowerKeltner(); // 헬퍼: 30봉, 마지막에 급락
    const ind = calculateIndicators(bars);
    const sig = detectKeltnerLowerBreakout(bars, ind);
    expect(sig?.type).toBe('keltner_lower_breakout');
    expect(sig?.direction).toBe('bearish');
  });
  it('returns null when close stays inside channel', () => {
    const bars = makeFlatRangeBars();
    const sig = detectKeltnerLowerBreakout(bars, calculateIndicators(bars));
    expect(sig).toBeNull();
  });
});
```
(헬퍼 `makeDowntrendBarsBreakingLowerKeltner`/`makeFlatRangeBars`는 같은 test 파일 상단에 결정적 봉 배열로 작성 — 종가/고저를 직접 지정.)

- [ ] **Step 2: 실패 확인** — `yarn test confirmed-bearish` → FAIL ("detectKeltnerLowerBreakout is not a function").

- [ ] **Step 3: detector 구현** (bullish `detectKeltnerUpperBreakout` c.ts:412 미러)
```ts
/** @internal Detects a close breaking below the lower Keltner channel (bearish confirmed signal). */
export function detectKeltnerLowerBreakout(
    bars: Bar[],
    indicators: IndicatorResult
): Signal | null {
    const keltner = indicators.keltnerChannel;
    const barsLength = bars.length;
    if (barsLength < 2 || keltner.length < 2) return null;
    const lastIdx = barsLength - 1;
    const prevKc = keltner[lastIdx - 1];
    const curKc = keltner[lastIdx];
    if (prevKc.lower === null || curKc.lower === null) return null;
    const prevClose = bars[lastIdx - 1].close;
    const curClose = bars[lastIdx].close;
    if (prevClose < prevKc.lower) return null;     // 이미 아래면 신규 아님
    if (curClose >= curKc.lower) return null;       // 아직 안 깨면 null
    return { type: 'keltner_lower_breakout', direction: 'bearish', phase: 'confirmed', detectedAt: lastIdx };
}
```

- [ ] **Step 4: 통과 확인** — `yarn test confirmed-bearish` → PASS.

- [ ] **Step 5: 나머지 8개 detector를 §매핑표대로 구현 + 각각 fires/null 테스트 2개씩**

**§ bearish 미러 매핑표** (각 행 = 1 detector + 2 테스트):
| 신규 함수 | bullish 짝(미러 원본) | 반전 규칙 |
|---|---|---|
| `detectSupertrendBearishFlip` | `detectSupertrendBullishFlip` c.ts:237 | trend `'up'→'down'` |
| `detectParabolicSarBearishFlip` | `detectParabolicSarFlip` c.ts:388 | trend `'up'→'down'` |
| `detectIchimokuCloudBreakdown` | `detectIchimokuCloudBreakout` c.ts:261 | kumo **lower** = min(senkouA,B); prevClose<lower→null, curClose≥lower→null (하향 이탈) |
| `detectCciBearishCross` | `detectCciBullishCross` c.ts:296 | `findThresholdCross(cci, [CCI_OVERBOUGHT_CROSS_LEVEL, CCI_BEARISH_CROSS_LEVEL], lookback, 'down')` |
| `detectDmiBearishCross` | `detectDmiBullishCross` c.ts:323 | `findCross(diMinus, diPlus, lookback, 'up')` + adx≥threshold; direction 'bearish' |
| `detectCmfBearishFlip` | `detectCmfBullishFlip` c.ts:345 | `findThresholdCross(cmf, CMF_BEARISH_CROSS_LEVEL, lookback, 'down')` |
| `detectSqueezeMomentumBearish` | `detectSqueezeMomentumBullish` c.ts:436 | `findThresholdCross(momentum, SQUEEZE_MOMENTUM_ZERO_CROSS, lookback, 'down')` |
| `detectMfiOverboughtReversal` | (신규) | `findThresholdCross(mfi, MFI_OVERBOUGHT_LEVEL, lookback, 'down')` |

- [ ] **Step 6: Commit**
```bash
git add src/domain/signals/confirmed.ts src/__tests__/domain/signals/confirmed-bearish.test.ts
git commit -m "feat(signals): add 9 bearish mirror detectors"
```

### Task 1.4: mfi_oversold_bounce를 lookback-cross로 수정

**Files:**
- Modify: `src/domain/signals/confirmed.ts` (`detectMfiOversoldBounce` c.ts:367-385)
- Test: `src/__tests__/domain/signals/confirmed-bearish.test.ts` (mfi describe 추가)

- [ ] **Step 1: 실패 테스트** — "최근 N봉 내 MFI가 oversold를 상향 통과하면 발화"(1봉 직후가 아니어도)
```ts
it('mfi_oversold_bounce fires on a cross within lookback (not just immediate prior bar)', () => {
  const bars = makeMfiCrossUpThreeBarsAgo(); // oversold 상향 통과가 2~3봉 전
  const sig = detectMfiOversoldBounce(bars, calculateIndicators(bars));
  expect(sig?.type).toBe('mfi_oversold_bounce');
});
```

- [ ] **Step 2: 실패 확인** — 현재 1봉 검사라 FAIL.

- [ ] **Step 3: 구현 교체**
```ts
export function detectMfiOversoldBounce(_bars: Bar[], indicators: IndicatorResult): Signal | null {
    const idx = findThresholdCross(indicators.mfi, MFI_OVERSOLD_LEVEL, CROSS_LOOKBACK_BARS, 'up');
    if (idx === null) return null;
    return { type: 'mfi_oversold_bounce', direction: 'bullish', phase: 'confirmed', detectedAt: idx };
}
```

- [ ] **Step 4: 통과 + 기존 mfi 테스트 회귀 없음 확인** — `yarn test confirmed`.

- [ ] **Step 5: Commit**
```bash
git commit -am "fix(signals): mfi_oversold_bounce uses lookback cross, not 1-bar check"
```

### Task 1.5: `detectSignals`에 10개 detector 등록

**Files:**
- Modify: `src/domain/signals/index.ts` (`detectSignals` 본문 + confirmed.ts re-export)
- Test: `src/__tests__/domain/signals/detect-signals-symmetry.test.ts`

- [ ] **Step 1: 대칭성 테스트** — "하락 시퀀스에서 bearish 신호들이 나온다"
```ts
it('emits bearish signals on a clear downtrend', () => {
  const bars = makeStrongDowntrendBars();
  const types = new Set(detectSignals(bars, calculateIndicators(bars)).map(s => s.type));
  expect([...types].some(t => t.endsWith('_bearish_cross') || t.endsWith('_bearish_flip') || t === 'keltner_lower_breakout')).toBe(true);
});
```

- [ ] **Step 2: 실패 확인** (아직 미등록).

- [ ] **Step 3: 등록** — `detectSignals` 본문의 detector 배열에 9개 bearish + (mfi는 이미 등록) 추가, `confirmed.ts` export 목록에 신규 함수 추가.

- [ ] **Step 4: 통과 확인** — `yarn test detect-signals-symmetry`.

- [ ] **Step 5: 전체 테스트 + typecheck + lint**
```bash
yarn test && yarn typecheck && yarn lint
```
Expected: all PASS.

- [ ] **Step 6: Commit**
```bash
git commit -am "feat(signals): register bearish detectors in detectSignals"
```

> **PR1 종료** → review-agent → 수정루프 → git-agent로 PR 생성.

---

# PR2 — selectSkills (순수 domain) + frontmatter + 게이팅 통합 + SMC + 캐시 (siglens-core)

PR1 머지 후. 핵심: 순수 `selectSkills` + `buildAnalysisPrompt` 통합. **레이어 규칙: domain은 I/O 금지.**

### Task 2.1: frontmatter 게이팅 타입

**Files:**
- Modify: `src/domain/types.ts` (`Skill`에 `gating?` 추가, 신규 `SkillGating`/`SkillSelectionContext`)
- Test: tsc

- [ ] **Step 1: 타입 정의**
```ts
export type SignalKind = 'event' | 'state';
export interface SkillStatePredicate {
    feature: 'bollinger' | 'keltner' | 'williamsR' | 'stochastic' | 'stochRsi'
           | 'donchian' | 'vwap' | 'buySellVolume';
    /** percent-B, band-distance(atr배수), ratio 등 술어 키 */
    predicate: 'pctB' | 'bandDistAtr' | 'level' | 'ratio' | 'channelProximity';
    hi?: number;   // 상단/과매수 임계
    lo?: number;   // 하단/과매도 임계
}
export interface SkillGating {
    tier: 'always_on' | 'gated';
    signalKind?: SignalKind;          // gated일 때 필수
    triggers?: readonly string[];     // event: detectSignals 신호명
    state?: SkillStatePredicate;      // state: textbook 술어
}
// Skill 인터페이스에 추가:
//   gating?: SkillGating;
//   tokenCost?: number;   // 빌드타임 baking
export interface SkillSelectionContext {
    indicators: IndicatorResult;
    signals: readonly Signal[];       // detectSignals 결과
    timeframe: '1Day' | '1Hour' | '15Min' | string;
    detectedCandles: readonly string[];
    atrPercent: number;               // ATR/price * 100 (Tier-0 ATR 승격 판정)
}
```

- [ ] **Step 2: typecheck PASS → Commit**
```bash
git commit -am "feat(types): add SkillGating + SkillSelectionContext"
```

### Task 2.2: textbook state 술어 (순수)

**Files:**
- Create: `src/domain/analysis/skillGatingPredicates.ts`
- Test: `src/__tests__/domain/analysis/skillGatingPredicates.test.ts`

- [ ] **Step 1: 실패 테스트** (TF별 %B 경계 포함)
```ts
import { isStateNotable } from '@/domain/analysis/skillGatingPredicates';
it('bollinger pctB fires above hi (TF-aware: 0.92 on 15Min)', () => {
  const ctx = makeCtx({ timeframe: '15Min', bollingerPctB: 0.93 });
  expect(isStateNotable({feature:'bollinger',predicate:'pctB'}, ctx)).toBe(true);
});
it('bollinger pctB does NOT fire at 0.91 on 15Min', () => {
  const ctx = makeCtx({ timeframe: '15Min', bollingerPctB: 0.91 });
  expect(isStateNotable({feature:'bollinger',predicate:'pctB'}, ctx)).toBe(false);
});
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현** — spec §게이팅 메커니즘의 textbook 임계값표 구현. TF별 %B 경계는 내부 상수:
```ts
const BOLLINGER_PCTB_BY_TF: Record<string,{hi:number;lo:number}> = {
  '1Day':{hi:0.98,lo:0.02}, '1Hour':{hi:0.95,lo:0.05}, '15Min':{hi:0.92,lo:0.08},
};
// keltner: |price-channel| ≤ 0.5*ATR 또는 이탈; williamsR ≥-20/≤-80; stochastic %K≥80/≤20;
// stochRsi ≥0.8/≤0.2; donchian 근접; vwap |dist|≥1*ATR (intraday only);
// buySellVolume ratio≥0.65/≤0.35 or divergence
export function isStateNotable(p: SkillStatePredicate, ctx: SkillSelectionContext): boolean { /* 표대로 */ }
```
(모든 임계값은 파일 상단 named 상수. VWAP은 `ctx.timeframe==='1Day'`면 항상 false.)

- [ ] **Step 4: 통과 + 각 feature별 fires/null 테스트(8 feature × 2) 작성 → PASS.**

- [ ] **Step 5: Commit**
```bash
git commit -am "feat(analysis): textbook state predicates for skill gating (TF-aware)"
```

### Task 2.3: `selectSkills` 순수 함수

**Files:**
- Create: `src/domain/analysis/selectSkills.ts`
- Test: `src/__tests__/domain/analysis/selectSkills.test.ts`

- [ ] **Step 1: 실패 테스트** (핵심 거동 5개)
```ts
import { selectSkills } from '@/domain/analysis/selectSkills';
it('always_on skills are always returned regardless of context', () => {
  const out = selectSkills([alwaysOnSkill('chart-pattern-x')], emptyCtx());
  expect(out.map(s=>s.name)).toContain('chart-pattern-x');
});
it('event-gated indicator guide loads only when its trigger signal is present', () => {
  const rsiGuide = eventSkill('rsi', ['rsi_oversold']);
  expect(selectSkills([rsiGuide], ctxWithSignals(['rsi_oversold'])).length).toBe(1);
  expect(selectSkills([rsiGuide], ctxWithSignals([])).length).toBe(0);
});
it('state-gated indicator guide loads only when textbook predicate fires', () => {
  const bb = stateSkill('bollinger', {feature:'bollinger',predicate:'pctB'});
  expect(selectSkills([bb], ctxBollPctB(0.99)).length).toBe(1);
  expect(selectSkills([bb], ctxBollPctB(0.5)).length).toBe(0);
});
it('candle guide loads only when that candle is detected', () => { /* ... */ });
it('output is deterministic: id total-order tie-break, stable under input shuffle', () => {
  const skills = [/* 동일 relevance 여러 개 */];
  expect(idsOf(selectSkills(skills, ctx))).toEqual(idsOf(selectSkills(shuffle(skills), ctx)));
});
it('fail-open: untagged skill is INCLUDED (not silently dropped)', () => {
  expect(selectSkills([untaggedSkill('x')], emptyCtx()).map(s=>s.name)).toContain('x');
});
```

- [ ] **Step 2: 실패 확인.**

- [ ] **Step 3: 구현** (순수 — 입력만으로 결정적; I/O·Date.now·random 금지)
```ts
export function selectSkills(skills: readonly Skill[], ctx: SkillSelectionContext): Skill[] {
  const selected: Skill[] = [];
  for (const s of skills) {
    const g = s.gating;
    if (!g) { selected.push(s); continue; }          // fail-open: 미태깅 포함
    if (g.tier === 'always_on') { selected.push(s); continue; }
    if (g.signalKind === 'event') {
      if (g.triggers?.some(t => ctx.signals.some(sig => sig.type === t))) selected.push(s);
    } else if (g.signalKind === 'state' && g.state) {
      if (isStateNotable(g.state, ctx)) selected.push(s);
    }
  }
  // 결정성: id(=name) 기준 total order
  return selected.toSorted((a,b)=>a.name.localeCompare(b.name));
}
```
(캔들 가이드는 `g.signalKind==='state'`로 `detectedCandles` 검사하거나 별도 분기; ATR-extreme Tier-0 승격은 buildAnalysisPrompt에서 ctx.atrPercent로 처리.)

- [ ] **Step 4: 통과 확인 + 90% branch 확인** — `yarn test selectSkills --coverage`.

- [ ] **Step 5: Commit**
```bash
git commit -am "feat(analysis): pure selectSkills gating function"
```

### Task 2.4: loader에 frontmatter 신규 필드 파싱 + name dedup

**Files:**
- Modify: `src/infrastructure/skills/loader.ts`
- Test: `src/__tests__/infrastructure/skills/loader-gating.test.ts`

- [ ] **Step 1: 실패 테스트** — `gating`/`tokenCost` 파싱 + 동일 name 중복 시 1개만(결정적).
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `toSkill()`에 `gating`(스키마 검증해 잘못된 값은 `undefined`+경고), `tokenCost` 파싱; `loadSkills`에 `name` 기준 dedup(먼저 온 것 유지).
- [ ] **Step 4: 통과.**
- [ ] **Step 5: Commit** `feat(skills): parse gating frontmatter + dedup by name`.

### Task 2.5: `buildAnalysisPrompt`가 `selectSkills` 사용 (스코핑)

**Files:**
- Modify: `src/domain/analysis/prompt.ts` (현재 `filter(weight>=0.5)` 라인 교체)
- Test: `src/__tests__/domain/analysis/prompt-gating.test.ts`

- [ ] **Step 1: 실패 테스트** — "buildAnalysisPrompt가 ctx에 안 맞는 gated 스킬을 프롬프트에서 제외; always_on은 포함; news/fundamental 경로는 영향 없음".
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — `buildAnalysisPrompt` 내부에서 `detectSignals` + ctx 구성 → `selectSkills(skills, ctx)` 결과만 type-bucket. **오직 차트 빌더만 수정**; `buildNewsPrompt`/`buildFundamentalPrompt`는 손대지 않음(category 필터 유지). ATR-extreme 승격: `ctx.atrPercent ≥ (timeframe==='1Day'?6:2)`면 sizing 노트 always-on 추가.
- [ ] **Step 4: 통과 + 결정성 테스트(동일 입력 byte-identical) + news/fundamental 무영향 테스트.**
- [ ] **Step 5: Commit** `feat(analysis): wire selectSkills into buildAnalysisPrompt (chart only)`.

### Task 2.6: SMC 처리 (압축 노트 + placeholder 제거 + 가드레일)

**Files:**
- Modify: `src/domain/analysis/prompt.ts` (SMC 가이드 주입 차단 + 압축노트 + 가드레일 전파)
- Test: `src/__tests__/domain/analysis/prompt-smc.test.ts`

- [ ] **Step 1: 실패 테스트** — (a) 풀 SMC 가이드는 프롬프트에 절대 안 들어감; (b) BOS/CHoCH ≤10봉이면 압축 5줄 노트 포함; (c) 안티-날조 가드레일 문구가 레벨-인용 섹션(Fib/S·R/pivot)에 존재.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — SMC 스킬은 `gating.tier` 무관하게 풀 주입 차단; `formatSMCSection`에 BOS/CHoCH recency 가드로 압축노트; 가드레일 상수를 레벨 섹션 헤더에 삽입.
- [ ] **Step 4: 통과.**
- [ ] **Step 5: Commit** `feat(analysis): SMC compressed note + anti-fabrication guardrail`.

### Task 2.7: 차트 캐시 키에 skill fingerprint fold

**Files:**
- Modify: 차트/fundamental 캐시키 생성부 (config의 `PROMPT_TEMPLATE_VERSION` 인접) + fingerprint 헬퍼
- Test: `src/__tests__/.../cacheKey-fingerprint.test.ts`

- [ ] **Step 1: 실패 테스트** — "서로 다른 skill 카탈로그(frontmatter gating 다름) → 다른 차트 캐시키".
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — news/overall의 `hashAnalysisInput` 패턴 재사용; 차트 키에 skill의 `name+gating+tokenCost` fingerprint 해시를 fold.
- [ ] **Step 4: 통과.**
- [ ] **Step 5: 전체 `yarn test && yarn typecheck && yarn lint` → Commit** `feat(cache): fold skill fingerprint into chart cache key`.

> **PR2 종료** → review-agent → 수정루프 → git-agent로 PR.

---

# PR3 — 스킬 frontmatter 태깅 + 압축 코어 + 검증 CI + fail-open (siglens)

PR1·PR2 머지 + core를 siglens가 참조(사용자가 core 릴리스). siglens 레포 작업(branch=master, claude-code-review CI).

### Task 3.1: gating frontmatter 태깅 — 67개

각 스킬 `.md` frontmatter에 `gating` 블록 추가. 아래는 RSI 가이드 **완전 예시**; 나머지는 §태깅 매핑표를 따른다.

**Files:** `skills/indicators/rsi.md` 외 66개

- [ ] **Step 1: rsi.md frontmatter**
```yaml
gating:
  tier: gated
  signal_kind: event
  triggers: [rsi_oversold, rsi_overbought, rsi_bullish_divergence, rsi_bearish_divergence]
token_cost: 0   # Task 3.4에서 baking
```

- [ ] **Step 2: §태깅 매핑표대로 나머지 66개 태깅**

**§ 태깅 매핑표:**
| 그룹 | tier | gating |
|---|---|---|
| 차트패턴 17 | `always_on` | — |
| 이론전략 4 (elliott-wave·wyckoff·fibonacci·multi-timeframe) | `always_on` | — |
| S/R 3 | `always_on` | — |
| 지표 event형(RSI·MACD·CCI·DMI·MFI·CMF·Supertrend·SAR) | `gated` | signalKind:event, triggers:[해당 신호명] |
| 지표 state형(Bollinger·Keltner·Williams·Stochastic·StochRSI·Donchian·VWAP·buySellVolume) | `gated` | signalKind:state, state:{feature,predicate} |
| Ichimoku·SMC | `always_on` | (풀 유지; SMC는 prompt.ts가 압축노트로 대체) |
| 캔들 7 | `gated` | signalKind:state(감지 목록 기준) |
| 전술전략 3 | `gated` | signalKind:event, triggers:[*_breakout/*_divergence/...] |
| 대순환 2 | `gated` | signalKind:event, triggers:[golden_cross/death_cross/macd_*_cross] |

- [ ] **Step 3: 검증** — Task 3.3 CI 스크립트로 모든 trigger가 카탈로그에 존재하는지 확인(아래).
- [ ] **Step 4: Commit** `feat(skills): add gating frontmatter to all 67 skills`.

### Task 3.2: 압축 지표코어 + 캔들 primer

**Files:**
- Create: `skills/_core/indicator-core.md`, `skills/_core/candle-primer.md`

- [ ] **Step 1: indicator-core.md** — 계산되는 각 지표 1줄(이름+임계 의미), **SMC 제외, Ichimoku는 풀이므로 코어엔 1줄 요약만**. 예: `RSI: >70 과매수 / <30 과매도 / 50선 모멘텀`.
- [ ] **Step 2: candle-primer.md** — 반전·지속·관망 패밀리 + "Detected 목록의 패턴만 해석".
- [ ] **Step 3: 테스트** — `src/__tests__/.../core-coverage.test.ts`: `formatIndicatorSection`이 렌더하는 모든 지표가 indicator-core에 1줄 존재(드리프트 방지).
- [ ] **Step 4: Commit** `feat(skills): compressed indicator core + candle primer`.

### Task 3.3: 스킬 검증 CI 스크립트

**Files:**
- Create: `scripts/validate-skills.ts`
- Modify: `.github/workflows/ci.yml`, `package.json`(script)
- Test: `scripts/__tests__/validate-skills.test.ts`

- [ ] **Step 1: 실패 테스트** — (a) trigger가 카탈로그에 없으면 실패; (b) gated인데 triggers/state 둘 다 없으면 실패(도달불가); (c) frontmatter 파싱 불가 파일 실패.
- [ ] **Step 2: 실패 확인.**
- [ ] **Step 3: 구현** — 모든 `skills/**/*.md` 로드 → gating 스키마 검증 + `triggers ∈ detectSignals 카탈로그(core export)` cross-check + 도달불가 검출 → 위반 시 `process.exit(1)`.
- [ ] **Step 4: CI 게이트 추가** — ci.yml에 `yarn validate:skills` 잡, package.json `"validate:skills":"tsx scripts/validate-skills.ts"`.
- [ ] **Step 5: 통과 + Commit** `feat(ci): skill frontmatter validation gate`.

### Task 3.4: token_cost 빌드타임 baking + 파서 통일

**Files:**
- Create: `scripts/bake-skill-tokens.ts`
- Modify: `src/entities/skill/api.ts` (core 로더 재사용 또는 신규 필드 파싱 일치)

- [ ] **Step 1:** `bake-skill-tokens.ts` — tiktoken으로 각 스킬 본문 토큰 수 계산 → frontmatter `token_cost` 갱신(빌드 스크립트, domain 아님).
- [ ] **Step 2:** `entities/skill/api.ts`의 frontmatter 파서를 core와 동일 필드 집합으로 통일(gating/tokenCost 인식).
- [ ] **Step 3: 테스트 + Commit** `chore(skills): bake token_cost + unify frontmatter parser`.

### Task 3.5: 마이그레이션 fail-open + 소비처 확인

**Files:**
- Modify: siglens가 `buildAnalysisPrompt`에 skills를 넘기는 호출부(분석 조합 흐름)

- [ ] **Step 1:** 차트 분석 호출부가 전체 skills를 넘기되, `selectSkills` 게이팅이 core에서 적용됨을 확인(이중 필터 없게). 미태깅 스킬 fail-open 경고 로그 확인.
- [ ] **Step 2: 통합 테스트 + Commit** `feat(siglens): wire gated skills into chart analysis`.

> **PR3 종료** → claude-code-review 루프 → 머지.

---

# 최종 검증 Phase (모든 PR 구현 + 수정루프 완료 후)

> 사용자 요청 7개 항목. 각 task는 **fresh-context 서브에이전트**(독립 컨텍스트)로 실행해 확증 편향을 피한다. 항목 1·5는 명시적으로 "fresh context".
>
> **⚠️ 보고 규칙(사용자 요청):** V1~V7을 *개별로 보고하지 말 것*. 7개를 모두 수행해 결과를 모은 뒤, **맨 마지막 V8에서 한 번에 종합 보고**한다.

### V1: 설계 적합성 (fresh context) — 항목 1
- [ ] fresh-context 서브에이전트에 spec(`2026-06-01-group-f-skill-gating-design.md`)만 주고, 머지된 코드가 설계대로인지 점검: **하이브리드 v2(event=signal/state=textbook) · 대칭화(bearish 9개+mfi) · 통합 가드레일 5(캐시 fingerprint·검증 CI·dead-metadata 방지·파서통일·fail-open) · 명시된 한계 반영 · 구현후 judge 훅 존재**. 누락/이탈을 항목별로 보고.

### V2·V3: 테스트 worst/edge case — 항목 2·3
- [ ] fresh-context 서브에이전트가 신규 테스트 파일을 감사: happy path 외 **worst case**(빈 배열·전부 미태깅·전부 always_on·신호 0개·신호 충돌) 와 **edge case**(임계값 경계 ±ε·null 지표값·≤2봉·TF별 %B 경계·중복 name·도달불가 스킬)가 실제로 테스트되는지. 빠진 케이스 목록 + 추가 테스트 제안.

### V4: 커버리지 90%+ — 항목 4
- [ ] `yarn test --coverage` 실행. 신규 파일(`selectSkills.ts`·`skillGatingPredicates.ts`·`confirmed.ts` bearish·loader·캐시 fingerprint)의 **branch 커버리지 ≥90%** 확인. 미달 시 보강 후 재측정. 수치 보고.

### V5: 신규 로직 오류 검증 (fresh context) — 항목 5
- [ ] fresh-context 서브에이전트가 신규 로직을 독립 재검토: bearish 미러의 부등호 방향·findThresholdCross 방향·selectSkills fail-open·TF별 %B·VWAP intraday-only·결정성 tie-break에 **논리 오류가 없는지** + 각각이 테스트로 커버되는지. 발견 결함 보고.

### V6: 프롬프트 개선 측정 — 항목 6
- [ ] 영구 캐시(`/Users/y0ngha/.cache/skilltest-fmp/`, 300 봉파일) 재사용, 100종목×3TF로 **전량 주입 vs 게이팅** 비교(병렬, oracle pool~15): 프롬프트 **사이즈**(실제 tiktoken cl100k, 전·후 토큰·절감%), **selection 정확도**(독립 oracle F1), regime 누수, 결정성. 결과표 보고.

### V7: 백테스트 재실행 비교 — 항목 7
**Files:** `../siglens/scripts/backtests/generate-backtest.ts`
- [ ] **Step 1: 수정** — L344 `buildAnalysisPrompt(ticker, contextBars, indicators, [], '1Day')`의 `[]`를 게이팅된 스킬로 교체:
  ```ts
  // skills 로드(loadSkills) → ctx 구성(detectSignals(contextBars,indicators), atrPercent 등)
  //   → selectSkills(allSkills, ctx) 결과를 4번째 인자로 전달
  const gated = selectSkills(loadSkills(), buildSelectionCtx(contextBars, indicators, '1Day'));
  return buildAnalysisPrompt(ticker, contextBars, indicators, gated, '1Day') + DECISIVENESS_SUFFIX;
  ```
  (TICKERS·FROM/TO·HOLD_DAYS·gemini-2.5-pro·temp0·topP0.95·thinkingBudget·MAX_SIGNALS 등 **다른 설정은 일절 변경 금지** — 프롬프트의 skills 인자만 바뀌어야 함.)
- [ ] **Step 2: 기존 data.json 백업** — `cp public/backtesting/data.json /tmp/data.before.json` (또는 git stash 비교 기준).
- [ ] **Step 3: 재실행** — `FORCE_FRESH=1 npx tsx scripts/backtests/generate-backtest.ts` (gemini batch, ~수십분 폴링).
- [ ] **Step 4: 비교 보고** — before vs after의 `meta`(winRate·**aiWinRate**·aiTrendHitRate·totalCases) 변화 + 케이스별 entryRecommendation/요약 차이를 표로. 게이팅이 AI 판정 품질을 올렸는지(aiWinRate↑) 정직히 보고. (메모리대로 levels forward-edge ~0이므로 signalWinRate가 아니라 **aiWinRate·trendHit**가 관전 포인트.)

### V8: 7개 종합 보고 (맨 마지막, 한 번에) — 사용자 요청
- [ ] V1~V7을 모두 수행한 뒤, **개별 중간보고 없이** 여기서 한 번에 종합 보고한다. 단일 리포트에 담을 것:
  1. **설계 적합성**(V1): 항목별 ✅/이탈/누락
  2. **테스트 worst/edge**(V2·V3): 커버 vs 빠진 케이스 + 보강 결과
  3. **커버리지**(V4): 신규 파일별 branch %(≥90 여부)
  4. **신규 로직 검증**(V5): 발견 결함 + 수정
  5. **프롬프트 개선**(V6): 토큰 전·후·절감%, oracle F1, 누수, 결정성
  6. **백테스트 비교**(V7): before vs after `meta`(winRate·aiWinRate·aiTrendHitRate·totalCases) 표 + 해석
  7. **최종 판정**: 게이팅이 설계대로 동작하며 품질을 (유지/향상)했는지 + 잔여 리스크
- 정직하게 측정 한계(oracle imperfect·single-snapshot·forward-edge ~0)를 명시한다.

---

## Self-Review (플랜 ↔ spec)

- **Spec coverage:** 3-tier(Task 2.5/3.1) · event=signal/state=textbook(2.2/2.3) · detectSignals 대칭화(PR1) · selectSkills 순수 domain(2.3) · frontmatter 스키마(2.1/3.1) · TF-aware(2.2) · SMC(2.6) · 가드레일 5(2.7 캐시·3.3 CI·dead-metadata는 2.3/3.1의 triggers 실배선·3.4 파서·2.3 fail-open) · 수용기준(V1·V6·V7) — 모두 매핑됨. ✅
- **Placeholder scan:** 반복 구조(bearish 9·frontmatter 67)는 1개 완전 예시 + 매핑표로 명세(엔지니어가 기계적으로 적용 가능). "TODO/적절히" 없음. ✅
- **Type consistency:** `SkillGating`/`SkillSelectionContext`/`isStateNotable`/`selectSkills` 시그니처가 2.1→2.2→2.3→2.5에서 일관. ✅
