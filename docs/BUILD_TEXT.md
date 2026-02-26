# TrendLens — 요구사항 명세서

AI 트렌드를 매일 수집·요약 해주는 Discord 봇

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **프로젝트명** | TrendLens |
| **한줄 설명** | AI 트렌드를 매일 수집·요약하여 Discord 봇으로 전송하는 자동화 시스템 |
| **개발 기간** | 1.5일 (약 12시간) |
| **개발 언어** | Node.js 18+ (JavaScript) |
| **인프라** | Ubuntu 서버 (24시간 상시 운영) |
| **총 비용** | 0원 목표 (아래 조건 참고) |

---

## 2. 문제 정의

| # | 문제 | 구체적 상황 | 영향 |
|---|------|------------|------|
| 1 | AI 트렌드 추적 어려움 | 매일 새로운 모델, 도구, 프레임워크가 쏟아짐 | 중요한 업데이트를 놓침 |
| 2 | 정보 과잉 | HN, Reddit, GitHub, 논문 등 소스가 분산 | 하나씩 확인하는 데 과도한 시간 소요 |
| 3 | 정리 비용 과다 | 수집한 정보를 직접 요약·정리해야 함 | 핵심 업무 시간 30분~1시간 손실 |

**해결 기준:** 매일 아침 Discord 메시지 1개만 확인하거나, `/trend` 명령어로 언제든 최신 트렌드를 파악할 수 있어야 한다.

---

## 3. 유사 프로젝트 분석 및 차별점

| 기존 프로젝트 | 한계점 | TrendLens 차별점 |
|--------------|--------|-----------------|
| Horizon (GitHub 29 stars) | Markdown 파일 출력, 즉시 확인 불가 | Discord 실시간 전송 |
| ai-news-agent | OpenAI 유료 의존, 이메일 전송 | Gemini 무료 tier, Discord 전송 |
| Daily AI Times | 멀티 에이전트 기반으로 과도하게 복잡 | 단일 파이프라인, 1일 내 완성 가능 |
| claude-rss-news-digest | Claude 유료 의존, RSS만 수집 | 4개 특화 소스, 완전 무료 |

**TrendLens 핵심 차별점:**
- 완전 무료 (LLM 포함)
- Discord 봇 상시 운영 (자동 전송 + `/trend` 온디맨드 조회)
- AI 특화 4대 소스 (뉴스/커뮤니티/도구/논문 축 분리)
- 1.5일 완성 가능한 단순 아키텍처

---

## 4. 데이터 소스 명세

### 4-1. 소스 목록

| # | 소스 | 커버 영역 | API 방식 | 인증 | 비용 |
|---|------|----------|----------|------|------|
| 1 | **HackerNews** | 업계 화제, 제품 출시 | Algolia Search API | 불필요 | 무료 |
| 2 | **Reddit** | 실무자 토론, 실험 결과 | Reddit JSON API | 불필요 | 무료 |
| 3 | **GitHub Trending** | 신규 오픈소스 도구 | HTML 스크래핑 | 불필요 | 무료 |
| 4 | **HuggingFace Daily Papers** | 커뮤니티 검증 최신 논문 | REST JSON API | 불필요 | 무료 |

### 4-2. 수집 기간 공통 정의

- **수집 범위:** 실행 시각 기준 직전 24시간 (UTC)
- **소스별 기준:** `created_at` 기반 필터가 가능한 소스(HN)는 시간 필터 적용, 불가능한 소스(Reddit hot, GitHub Trending)는 정렬 기반 상위 N건 수집
- **수동 실행(`/trend` 명령어) 정책:** 동일 날짜 재실행 시 중복 전송 허용 (idempotent 아님) — 온디맨드 용도이므로 동일 결과 재전송 OK

### 4-3. 소스별 수집 기준

**HackerNews (Algolia API)**
- 엔드포인트: `http://hn.algolia.com/api/v1/search`
- 키워드: `["AI", "LLM", "GPT", "Claude", "Gemini", "agent", "RAG", "fine-tune", "open-source model"]`
- 필터: 최근 24시간 (UTC 기준), score >= 100
- Fallback: 임계값 미달 시 score 내림차순 상위 10건 수집
- 최대 수집: 10건/일

**Reddit (JSON API)**
- 엔드포인트: `https://www.reddit.com/r/{subreddit}/hot.json`
- 대상 서브레딧: `r/MachineLearning`, `r/LocalLLaMA`, `r/artificial`
- 필터: ups >= 50
- Fallback: 임계값 미달 시 ups 내림차순 상위 5건 수집
- 최대 수집: 5건/서브레딧 (총 15건)
- ⚠️ **주의사항:**
  - `User-Agent` 헤더 필수 (예: `TrendLens/1.0 by /u/{username}`)
  - 서브레딧별 호출 간 1~2초 지연 적용 (Rate Limit 회피)
  - 응답의 `x-ratelimit-remaining`, `x-ratelimit-reset` 헤더를 로깅
  - 429/403 응답 시 해당 실행에서 Reddit 섹션 전체 생략
- 🔄 **OAuth 인증 (권장 — 사실상 Must):**
  - Reddit은 비인증 `.json` 요청을 공격적으로 차단하는 추세 → OAuth가 안정적
  - Reddit 무료 OAuth 앱(Personal Use Script) 등록 + `fetch`로 Bearer Token 요청
  - 환경변수: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET` (미설정 시 비인증 fallback)

**GitHub Trending (HTML 스크래핑)**
- URL: `https://github.com/trending/python?since=daily`
- 파싱: cheerio
- 최대 수집: 5건/일
- ⚠️ **리스크:** HTML 구조 변경 시 파싱 실패 가능
- **필수:** `try-catch`로 Graceful Degradation 처리 (파이프라인 중단 방지)
- 🔄 **자동 폴백 → GitHub Search API:**
  - 폴백 트리거 조건 (하나라도 해당 시 즉시 전환):
    1. HTTP 응답 에러 (4xx/5xx)
    2. 파싱 결과 0건 (셀렉터 불일치)
    3. 기대하는 DOM 요소(`article.Box-row`) 미검출
  - 폴백 엔드포인트: `GET /search/repositories?q=language:python+created:>={yesterday}&sort=stars&order=desc`
  - ⚠️ **미인증 Rate Limit:** GitHub Search API는 미인증 시 **10 req/min**으로 매우 낮음 — 폴백 호출은 1회/실행이므로 통상 문제없으나, 단시간 재실행 시 429 발생 가능
  - 폴백도 실패 시: GitHub 섹션 생략

**HuggingFace Daily Papers (REST API)**
- 엔드포인트: `https://huggingface.co/api/daily_papers`
- 날짜 지정: 쿼리 파라미터 `?date=YYYY-MM-DD` (예: `?date=2026-02-25`) — 미지정 시 오늘 날짜 기준
- 응답 필드: `title`, `summary`, `upvotes`, `githubRepo`
- 정렬: upvotes 기준 내림차순
- 최대 수집: 5건/일

### 4-4. 공통 HTTP 정책

**타임아웃:**

| 구분 | 타임아웃 | 비고 |
|------|---------|------|
| fetchers (HN, Reddit, HF) | **10초** | API 응답 지연 시 해당 소스 생략 |
| GitHub Trending (HTML) | **10초** | 스크래핑 대상, 지연 가능성 높음 |
| GitHub Search API (폴백) | **10초** | 폴백이므로 동일 기준 적용 |
| `/summarize` URL fetch | **15초** | 외부 웹페이지 대상, 여유 확보 |

- 모든 HTTP 요청은 Node 18+ 내장 `fetch` + `AbortSignal.timeout(ms)`으로 통일
- 타임아웃 초과 시 `AbortError` → 해당 소스/요청 생략 (파이프라인 중단 방지)

**동기 파싱 라이브러리 참고:**
- `cheerio` (GitHub Trending HTML 파싱)는 동기 파싱이지만 DOM 크기가 작아 이벤트 루프 블로킹 이슈 미미
- `@extractus/article-extractor` (본문 추출)는 async API 제공

```javascript
const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
const html = await res.text();
const items = cheerio.load(html);
```

---

## 5. 공통 데이터 모델

모든 소스에서 수집한 데이터를 통합하기 위한 공통 스키마:

```javascript
/**
 * @typedef {Object} TrendItem
 * @property {string} title        - 제목
 * @property {string} url          - 원본 링크
 * @property {string} source       - "hackernews" | "reddit" | "github" | "huggingface"
 * @property {number} score        - 점수 (HN points / Reddit ups / GitHub stars / HF upvotes)
 * @property {string|null} summary - 요약 (있는 경우)
 * @property {Date} createdAt      - 수집 시점 (UTC)
 * @property {Object} metadata     - 소스별 추가 정보 (subreddit, language 등)
 */
```

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `title` | `string` | O | 항목 제목 |
| `url` | `string` | O | 원본 링크 (중복 제거 키 — 아래 URL 정규화 규칙 적용) |
| `source` | `string` | O | 데이터 소스 식별자 |
| `score` | `number` | O | 소스별 반응 수치 (정규화 불필요, 소스 내 비교용) |
| `summary` | `string \| null` | X | HF 논문 등 요약이 제공되는 경우 |
| `createdAt` | `Date` | O | 수집 시점 (UTC) |
| `metadata` | `Object` | O | 소스별 추가 정보 (예: `{"subreddit": "LocalLLaMA"}`) |

**URL 정규화 규칙 (중복 제거 키 생성용):**

Node.js 내장 `URL` API를 사용하여 아래 규칙을 순차 적용한 정규화된 URL을 중복 제거 키로 사용한다.

| # | 규칙 | 변환 예시 |
|---|------|----------|
| 1 | 스킴 소문자 통일 | `HTTP://` → `http://` |
| 2 | 호스트 소문자 통일 | `GitHub.Com` → `github.com` |
| 3 | UTM 파라미터 제거 | `?utm_source=twitter&utm_medium=social` 제거 |
| 4 | 추적 파라미터 제거 | `ref`, `source`, `fbclid`, `gclid` 등 제거 |
| 5 | trailing slash 제거 | `https://example.com/path/` → `https://example.com/path` |
| 6 | mobile 도메인 변환 | `m.reddit.com` → `reddit.com`, `mobile.twitter.com` → `twitter.com` |
| 7 | fragment(#) 제거 | `https://example.com/page#section` → `https://example.com/page` |

```javascript
const STRIP_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'ref', 'source', 'fbclid', 'gclid', 'si',
]);
const MOBILE_DOMAINS = { 'm.reddit.com': 'reddit.com', 'mobile.twitter.com': 'twitter.com',
                         'm.youtube.com': 'youtube.com' };

function normalizeUrl(raw) {
  const parsed = new URL(raw.trim());
  const host = MOBILE_DOMAINS[parsed.hostname.toLowerCase()] ?? parsed.hostname.toLowerCase();
  for (const key of [...parsed.searchParams.keys()]) {
    if (STRIP_PARAMS.has(key)) parsed.searchParams.delete(key);
  }
  const path = parsed.pathname.replace(/\/+$/, '') || '/';
  parsed.hash = '';
  return `${parsed.protocol}//${host}${path}${parsed.search}`;
}
```

**중복 제거 시 소스 우선순위:**

동일 URL이 여러 소스에서 수집된 경우 (예: 같은 기사가 HN과 Reddit에 동시 등장), 아래 우선순위에 따라 **1건만 유지**한다:

1. **HackerNews** — score 기반 정량 지표가 가장 신뢰할 수 있음
2. **Reddit** — 커뮤니티 토론 맥락 제공
3. **HuggingFace** — 논문 특화 요약 포함
4. **GitHub** — 레포지토리 단위 정보

우선순위가 높은 소스의 `TrendItem`을 유지하고, 나머지는 제거한다. 로그에는 `"중복 제거: {url} — {제거된 소스} → {유지된 소스}"` 형식으로 기록한다.

---

## 6. 기능 명세

### 6-1. 파이프라인 기능

| ID | 기능 | 설명 | 입력 | 출력 |
|----|------|------|------|------|
| F-01 | 데이터 수집 | 4개 소스에서 데이터 크롤링 | API 호출 | `TrendItem[]` |
| F-02 | 중복 제거 | 정규화된 URL 기반 중복 항목 제거 | `TrendItem[]` | 중복 제거된 `TrendItem[]` |
| F-03 | AI 요약 | Gemini로 수집 항목 전체를 한국어 요약 | `TrendItem[]` | 핵심 3줄 + 상세 요약 |
| F-04 | Discord 전송 | discord.js Client로 지정 채널에 메시지 전송 | 포맷된 메시지 | 채널 메시지 |
| F-05 | 자동 스케줄링 | `node-cron`으로 매일 09:00 KST 자동 실행 (수집만, 요약 생략) | 시간 트리거 | 수집 결과 전송 |
| F-06 | 실패 알림 | 수집·요약·전송 실패 시 Discord 에러 알림 전송 | 예외 발생 | Discord 에러 메시지 |
| F-07 | 실행 결과 기록 | 실행 메타데이터를 로컬 JSON 파일로 저장 | 파이프라인 결과 | `logs/result_{date}.json` |
| F-08 | Gemini 쿼터 추적 | API 호출 횟수를 내부 카운터로 추적, 임계치 도달 시 Discord 경고 | API 호출 | 경고 메시지 or 로그 |
| F-11 | 동시 실행 제어 | 파이프라인은 동시에 1개만 실행 허용 (boolean 플래그, 싱글 스레드) | 명령어/스케줄 호출 | 실행 중이면 안내 메시지 |
| F-12 | 개인 API 키 관리 | 사용자별 Gemini API 키를 인메모리(`Map`)로 관리 — 디스크 저장 없음 | `/apikey` 명령어 | 키 등록/조회/삭제 |

### 6-2. 명령어 타입

본 봇은 **Slash Command (Application Command)**만 사용합니다.

| 명령어 타입 | 사용 여부 | 이유 |
|------------|:---:|------|
| **Slash Command** | O | Discord 공식 지원, 자동완성/드롭다운 UI, 타입 검증 내장 |
| Prefix Command (`!trend`) | X | Message Content Intent 필요 (Privileged), 오타 가능성 |
| Context Menu Command | X | 트렌드 조회 용도에 적합하지 않음 |

**명령어 등록 방식:**
- **Guild Command** (특정 서버에만 등록) — 반영 즉시, 개발/테스트에 유리
- `REST.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands })` 호출 시점: 봇 `ready` 이벤트

**Discord Intents:**
- `{ intents: [GatewayIntentBits.Guilds] }` — 최소 Intents만 사용
- Privileged Intents (Message Content, Members, Presence) **불필요**

### 6-3. 슬래시 명령어 명세

모든 명령어는 Slash Command로 구현하며, 3개 카테고리로 분류합니다.

#### 카테고리 1: 트렌드 명령어 (Must Have)

| 명령어 | 설명 | 옵션 | 응답 흐름 |
|--------|------|------|----------|
| `/trend` | 전체 소스 트렌드 수집+요약 | `[date]`: 특정 날짜 조회 (기본: 오늘) | Deferred → 파이프라인 실행 → 결과 메시지 |
| `/source` | 특정 소스만 조회 | `name`: Choices 드롭다운 (필수) | Deferred → 해당 소스만 수집 → 결과 메시지 |

#### 카테고리 2: API 키 관리 명령어 (Must Have)

| 명령어 | 설명 | 제한 | 응답 흐름 |
|--------|------|------|----------|
| `/apikey set` | Gemini API 키 등록 | **DM 전용** | Ephemeral 응답 (본인만 표시) |
| `/apikey status` | 키 등록 상태 확인 | 없음 | Ephemeral 응답 |
| `/apikey remove` | 등록된 키 삭제 | 없음 | Ephemeral 응답 |

#### 카테고리 3: 관리/모니터링 명령어 (Must Have)

| 명령어 | 설명 | 권한 | 응답 흐름 |
|--------|------|------|----------|
| `/status` | 봇 상태 확인 | 없음 | 즉시 응답 |
| `/logs` | 최근 로그 조회 | 관리자 전용 | 즉시 응답 (파일 업로드) |
| `/quota` | 본인 Gemini API 사용량/잔여 쿼터 확인 | 없음 | Ephemeral 응답 |

#### 카테고리 4: 확장 명령어 (Must Have)

| 명령어 | 설명 | 옵션 | 응답 흐름 |
|--------|------|------|----------|
| `/summarize` | 특정 URL의 상세 한국어 리포트 생성 | `url`: 대상 URL (필수) | Deferred → 본문 추출 → Gemini 요약 → 리포트 전송 |
| `/config` | Discord 내에서 봇 설정 변경 | `item`: Choices (필수), `value`: 값 (필수) | 즉시 응답 → `config_override.json` 저장 |

### 6-4. 명령어 상세 명세

**`/apikey set`**
- 옵션: `key` (필수, `String`)
- **DM(개인 메시지) 전용** — 공개 채널에서 실행 시: `"🔒 API 키는 보안을 위해 DM에서만 등록할 수 있습니다."` (Ephemeral)
- **DM 불가 시 안내:** 봇이 DM 전송에 실패하면(사용자가 DM 차단 등): `"⚠️ DM을 보낼 수 없습니다. 서버 설정 > 개인정보 보호 > '서버 멤버가 보내는 다이렉트 메시지 허용'을 켜주세요."` (Ephemeral)
- 동작 흐름:
  1. Gemini API에 경량 test 호출(`model.generateContent("ping")`)로 키 유효성 검증 — `models.list`는 SDK/엔드포인트 변경에 취약하므로 실제 생성 호출 사용
  2. 유효 → `KeyStore` 인메모리 `Map`에 `{userId: apiKey}` 저장
  3. 무효 → `"❌ 유효하지 않은 API 키입니다. AI Studio에서 키를 확인해주세요."` (Ephemeral)
- 성공 응답: `"✅ Gemini API 키가 등록되었습니다. /trend, /summarize 명령어를 사용할 수 있습니다."` (Ephemeral)
- **키 보관 정책:** 봇 메모리(`Map`)에만 저장, 디스크·DB 영구 저장 없음 — 봇 재시작 시 소멸하므로 재등록 필요
- **재시작 후 자동 안내:** 봇 재시작 후 사용자가 키가 필요한 명령어(`/trend`, `/source`, `/summarize`)를 처음 호출할 때 1회만 안내: `"🔄 봇이 재시작되어 API 키가 초기화되었습니다. /apikey set으로 다시 등록해주세요."` — 이후 같은 사용자에게 반복 안내하지 않음 (인메모리 `Set`으로 1회성 제어)

**`/apikey status`**
- 동작: 호출한 사용자의 키 등록 여부 표시 (Ephemeral)
- 등록됨: `"🔑 API 키 등록됨 | 마지막 사용: 09:01 KST (/trend) | 키: ****{마지막 4자}"`
- 미등록: `"🔑 API 키 미등록 | /apikey set으로 등록해주세요."`

**`/apikey remove`**
- 동작: `KeyStore`에서 호출 사용자의 키 삭제 (Ephemeral)
- 성공: `"🗑️ API 키가 삭제되었습니다."`
- 미등록 상태: `"🔑 등록된 API 키가 없습니다."`

**`/trend`**
- 옵션: `date` (선택, `String`, 형식: `YYYY-MM-DD`, 기본값: 오늘)
- 동작: 지정 날짜 기준 직전 24시간 트렌드 수집 → 요약 → 전송
- **API 키 정책:** 호출 사용자의 개인 키 사용 — 미등록 시 수집 결과만 전송 (요약 생략) + `"🔑 Gemini 요약을 사용하려면 /apikey set으로 API 키를 등록해주세요."` 안내
- **날짜 유효성 검증:**
  - `YYYY-MM-DD` 형식이 아닌 경우: `"📅 날짜 형식이 올바르지 않습니다. 예: 2026-02-25"`
  - **미래 날짜** (오늘보다 이후): `"📅 미래 날짜는 조회할 수 없습니다. 오늘 또는 과거 날짜를 입력해주세요."`
  - **30일 초과 과거 날짜:** `"📅 최대 30일 전까지만 조회할 수 있습니다."` (API 데이터 보존 한계)
- 과거 날짜 지정 시 소스별 동작:

| 소스 | 과거 날짜 지원 | 동작 |
|------|:---:|------|
| HackerNews | O | Algolia `created_at_i` 파라미터로 해당 날짜 검색 |
| HuggingFace | O | API 날짜 파라미터로 해당 날짜 논문 조회 |
| Reddit | X | 해당 소스 섹션 생략 (기본) — 응답 하단에 `"ℹ️ Reddit, GitHub Trending은 과거 날짜 조회를 지원하지 않아 생략되었습니다."` 안내 |
| GitHub Trending | X | 해당 소스 섹션 생략 (기본) — 위와 동일 안내 |

- 쿨다운: 커스텀 구현 — `/trend`, `/source`, `/summarize` 3개 명령어가 하나의 쿨다운 버킷 공유 (사용자당 5분에 1회)
- 쿨다운 중 재호출 시: `"⏳ 쿨다운 중입니다. {남은 시간}초 후 다시 시도해주세요."`

**`/source`**
- 옵션: `name` (필수, Choices 드롭다운)
- Choices 정의 (`{ name, value }` 배열):
  - `HackerNews` (value: `hackernews`)
  - `Reddit` (value: `reddit`)
  - `GitHub` (value: `github`)
  - `HuggingFace` (value: `huggingface`)
- 사용자가 직접 타이핑 불가 — 자동완성 목록에서만 선택 (오타 방지)
- 쿨다운: `/trend`와 동일 버킷 공유 (커스텀 구현)
- **API 키 정책:** `/trend`와 동일 (개인 키 사용, 미등록 시 요약 생략)

**`/status`**
- 권한: 없음 (누구나 사용 가능)
- 출력 예시: `"🟢 정상 작동 중 | 핑: 45ms | 업타임: 3일 2시간 | 최근 재시작: 2026-02-24 06:12 KST | 다음 자동 전송: 09:00 KST | 마지막 성공: 2026-02-26 09:01 (25건)"`
- 데이터 소스: `logs/result_{date}.json`에서 마지막 실행 정보 조회, 업타임/재시작 시각은 봇 기동 시 `Date.now()` 기록
- **재시작 직후 공지:** 봇 `ready` 이벤트 시 트렌드 채널에 1회 공지: `"🔄 봇이 재시작되었습니다. API 키를 등록하신 분은 /apikey set으로 재등록해주세요."` (이전 세션에서 키를 등록했던 사용자를 알 수 없으므로 채널 공지로 대체)
- **공지 스팸 방지:** 재시작 공지는 최소 10분 간격으로 제한 — 직전 공지 시각을 로컬 파일(`logs/last_restart_notice.txt`)에 기록하여 크래시 루프 시 반복 공지 차단

**`/logs`**
- 권한: 관리자 전용 (`interaction.memberPermissions.has(PermissionFlagsBits.Administrator)`)
- 동작: `logs/result_{오늘날짜}.json` 파일을 Discord 채팅에 파일 첨부로 업로드
- **업로드 대상 제한:** `result_*.json`만 허용 — 토큰·헤더·환경변수 값이 포함된 시스템 로그는 업로드 불가
- Fallback: 파일 미존재 시 `"📭 오늘의 로그가 없습니다."` 응답

**`/quota`**
- 권한: 없음 (누구나 사용 가능)
- 동작: 호출 사용자 본인의 Gemini API 사용량을 인메모리 카운터에서 조회하여 표시 (Ephemeral)
- 데이터 소스: `KeyStore` 내부 per-user 사용량 카운터 (인메모리)
- 출력 예시: `"📊 내 Gemini API 사용량 (오늘)\n• 호출: 3 / 50 RPD\n• 잔여: 47회\n• 마지막 호출: 09:01 KST (/trend)"`
- 키 미등록 시: `"🔑 API 키가 등록되지 않았습니다. /apikey set으로 등록해주세요."`
- 쿼터 한도 기준: `/config` 명령어의 `gemini_rpd` 설정 값 (기본: `50`)

**`/summarize`**
- 옵션: `url` (필수, `String`)
- **API 키 정책:** 개인 키 필수 — 미등록 시 즉시 거부 `"🔑 /summarize를 사용하려면 /apikey set으로 API 키를 등록해주세요."`
- 동작 흐름:
  1. 개인 키 등록 여부 확인 → 미등록 시 거부
  2. URL 유효성 검증 (http/https 스킴 확인)
  3. **SSRF 방지 검증** — 아래 차단 목록에 해당하면 즉시 거부
  4. `fetch`로 HTML 페이지 요청 (타임아웃 15초, `AbortSignal.timeout`)
  5. `@extractus/article-extractor`로 본문 텍스트 추출
  6. 추출 텍스트가 10,000자 초과 시 상위 10,000자로 절단 (Gemini 컨텍스트 보호)
  7. 사용자의 개인 키로 Gemini에 "상세 한국어 리포트 작성" 프롬프트 전송
  8. 결과를 Discord 메시지로 응답
- 🔒 **SSRF 방지 (필수):**
  - 사용자 입력 URL로 서버가 HTTP 요청을 보내므로, 내부 네트워크 접근을 차단해야 함
  - URL 파싱 후 호스트를 DNS 해석하여 **실제 IP 기준**으로 차단 (호스트명 우회 방지)
  - 차단 대상:
    - `127.0.0.0/8` (localhost)
    - `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` (Private IP)
    - `169.254.0.0/16` (Link-local, AWS 메타데이터 엔드포인트 포함)
    - `0.0.0.0/8`, `::1`, `fc00::/7` (IPv6 loopback/private)
  - 차단 시 응답: `"🔒 내부 네트워크 주소는 접근할 수 없습니다."`
  - 구현: `dns.promises.lookup()`으로 IP 해석 후 `node:net`의 `isIP()` + CIDR 범위 수동 체크 또는 `ipaddr.js` 라이브러리 활용
- 쿨다운: `/trend`와 동일 버킷 공유 (커스텀 구현)
- Deferred 응답: `"🔍 URL을 분석 중입니다... (약 10~20초 소요)"`

**`/config`**
- 옵션: `item` (필수, Choices 드롭다운), `value` (필수, `String`)
- 권한: 관리자 전용 (`interaction.memberPermissions.has(PermissionFlagsBits.Administrator)`)
- 저장: `config_override.json` (로컬 JSON 파일, 봇 재시작 시 유지)
- 봇 시작 시 `config_override.json`이 존재하면 로드하여 기본값 덮어쓰기
- 응답 예시: `"⚙️ 설정 변경 완료: time 09:00 → 08:30"`
- 설정 항목 (`{ name, value }` choices 배열):

| Choice 이름 | value | 설명 | 유효 값 | 기본값 |
|-------------|-------|------|---------|--------|
| `자동 전송 시간` | `time` | 매일 자동 트렌드 전송 시각 (KST) | `HH:MM` 형식 | `09:00` |
| `전송 채널` | `channel` | 트렌드 메시지 전송 대상 채널 | 채널 ID (숫자, 존재 검증) | 미설정 (봇 추가 후 `/config channel`로 지정) |
| `소스 ON/OFF` | `sources` | 특정 소스 활성화/비활성화 | `{소스명} on\|off` (예: `reddit off`) | 전체 `on` |
| `쿨다운` | `cooldown` | `/trend`, `/source`, `/summarize` 쿨다운 (초) | `60` ~ `600` | `300` |
| `요약 언어` | `language` | AI 요약 출력 언어 | `ko`, `en` | `ko` |
| `Gemini RPD 한도` | `gemini_rpd` | Gemini 일일 호출 한도 (쿼터 추적/알림 기준) | `10` ~ `500` | `50` |

**쿨다운 구현 방식:**
- discord.js 내장 쿨다운은 명령어별 독립 쿨다운이며 런타임 변경이 불가하므로 **사용하지 않음**
- 커스텀 쿨다운: `Map<string, number>` (`{userId: lastUsedTimestamp}`)로 직접 구현
- **쿨다운 적용 대상:** `/trend`, `/source`, `/summarize` 3개 명령어만 공유 버킷 적용 — `/apikey`, `/status`, `/quota`, `/logs`, `/config`는 쿨다운 대상에서 제외
- `/trend`, `/source`, `/summarize` 3개 명령어가 하나의 버킷을 공유
- `/config cooldown` 변경 시 즉시 적용 (데코레이터 재등록 불필요)

**`/config channel` 변경 시 검증:**
- 입력값이 숫자인지 확인 (정규식 `^\d+$`)
- `client.channels.cache.get(value)`로 해당 채널이 봇이 접근 가능한 서버 내에 존재하는지 검증
- 채널이 존재하지 않거나 봇에 `Send Messages` 권한이 없는 경우: `"⚙️ 해당 채널을 찾을 수 없습니다. 유효한 채널 ID를 입력해주세요."`
- 채널 타입이 `TextChannel`이 아닌 경우 (음성/카테고리 등): `"⚙️ 텍스트 채널만 지정할 수 있습니다."`

**`/config time` 변경 시 동작:**
- 기존 `node-cron` 작업을 `job.stop()` → 새 cron 표현식으로 작업 재생성 → `job.start()`
- 변경 즉시 반영되며, 다음 실행은 새 시간 기준
- **타임존 정책:** 모든 스케줄 시간은 `Asia/Seoul` (KST, UTC+9) 기준으로 고정 — `node-cron`의 `timezone` 옵션(`{ timezone: 'Asia/Seoul' }`)으로 설정

**동시 실행 제어 (F-11):**
- 파이프라인 실행(`/trend`, 스케줄 자동 실행)은 전역 `let isRunning = false` 플래그로 동시에 1개만 허용 (Node.js는 싱글 스레드이므로 Lock 불필요)
- 파이프라인 실행 중 `/trend` 또는 `/summarize` 호출 시: `"🔄 현재 트렌드 수집이 진행 중입니다. 완료 후 다시 시도해주세요."` 응답
- 이를 통해 Gemini/Reddit API 폭증, 채널 메시지 뒤섞임, 쿼터/쿨다운 꼬임 방지

**에러 응답 규격 (공통):**
- API 키 미등록 (요약 필수 명령어): `"🔑 /summarize를 사용하려면 /apikey set으로 API 키를 등록해주세요."`
- API 키 미등록 (요약 선택 명령어): 요약 생략 후 수집 결과만 전송 + `"🔑 Gemini 요약을 사용하려면 /apikey set으로 API 키를 등록해주세요."`
- API 키 등록 채널 오류: `"🔒 API 키는 보안을 위해 DM에서만 등록할 수 있습니다."`
- API 키 유효하지 않음: `"❌ 유효하지 않은 API 키입니다. AI Studio에서 키를 확인해주세요."`
- 쿨다운 초과: `"⏳ 쿨다운 중입니다. {남은 시간}초 후 다시 시도해주세요."`
- 권한 부족: `"🔒 관리자만 사용할 수 있는 명령어입니다."`
- 파이프라인 실행 중: `"🔄 현재 트렌드 수집이 진행 중입니다. 완료 후 다시 시도해주세요."`
- 파이프라인 실패: `"❌ 트렌드 수집에 실패했습니다: {에러 내용}"`
- 잘못된 날짜 형식: `"📅 날짜 형식이 올바르지 않습니다. 예: 2026-02-25"`
- 미래 날짜 입력: `"📅 미래 날짜는 조회할 수 없습니다. 오늘 또는 과거 날짜를 입력해주세요."`
- 30일 초과 과거 날짜: `"📅 최대 30일 전까지만 조회할 수 있습니다."`
- URL 접근 불가: `"🔗 해당 URL에 접근할 수 없습니다: {에러 내용}"`
- SSRF 차단 (내부 네트워크): `"🔒 내부 네트워크 주소는 접근할 수 없습니다."`
- 본문 추출 실패: `"📄 페이지 본문을 추출할 수 없습니다. 다른 URL을 시도해주세요."`
- 잘못된 설정 값: `"⚙️ 올바르지 않은 값입니다. {형식 안내}"`
- 존재하지 않는 채널: `"⚙️ 해당 채널을 찾을 수 없습니다. 유효한 채널 ID를 입력해주세요."`
- Gemini 쿼터 초과: `"⚠️ Gemini API 일일 한도에 도달했습니다. 내일 재시도해주세요."`

### 6-5. 부가 기능 (Nice to Have)

| ID | 기능 | 설명 |
|----|------|------|
| F-09 | 카테고리 분류 | 뉴스/커뮤니티/도구/논문 섹션 자동 분리 |
| F-10 | 중요도 하이라이트 | 반응 수 기반 Top 3 강조 |

---

## 7. AI 요약 명세

| 항목 | 내용 |
|------|------|
| **모델** | Gemini 2.5 Flash (Google AI Studio 무료 tier) |
| **일일 사용량** | 사용자별 개인 키 기준 — `/trend` 1 RPD + `/summarize` 건당 1 RPD (자동 스케줄은 요약 생략) |
| **무료 tier 제한** | [AI Studio 콘솔](https://aistudio.google.com)에서 프로젝트별 실제 쿼터 확인 (계정/시점에 따라 변동) |
| **프롬프트 전략** | 전체 항목을 1회 호출로 전달, 한국어 응답 요청 |
| **예상 입력 크기** | 최대 35건 × ~200자 ≈ ~7,000자 (~3,000 토큰) → 무료 한도 내 |
| **출력 구조** | 핵심 3줄 요약 + 전체 트렌드 분석 2~3문단 |

**프롬프트 요구사항:**
- 입력: 수집된 전체 항목 (제목, URL, 점수, 소스, 요약)
- 출력 1: 오늘의 핵심 3줄 요약 (bullet point, 각 bullet에 근거 URL 1개 이상 첨부)
- 출력 2: 전체 트렌드 분석 (한국어, 2~3문단)
- 제약:
  - 사실 기반만 작성, 추측 금지
  - **입력에 없는 모델명/제품명/수치를 생성하지 않을 것** (hallucination 방지)
  - 모든 주장에 입력 데이터의 URL을 근거로 명시

**`/summarize` 전용 프롬프트 요구사항:**
- 입력: `@extractus/article-extractor`로 추출한 웹페이지 본문 (최대 10,000자)
- 출력: 1장짜리 한국어 리포트 (아래 구조)
  - 핵심 내용 요약 (3~5줄)
  - 기술적 의의 및 영향
  - 한계점 또는 주의사항
- 제약:
  - 입력 본문에 없는 정보를 생성하지 않을 것 (hallucination 방지)
  - 출력 언어는 `/config language` 설정 값에 따름 (기본: 한국어)

**Gemini 쿼터 추적 및 알림 (F-08):**
- **사용자별 인메모리 카운터**로 추적: `KeyStore` 내부 `{user_id: {count, last_used_at, date}}` 구조
- 디스크 로그(`logs/gemini_usage_{YYYY-MM-DD}.json`)는 보조 기록용으로 유지 (사용자별 호출 이력 적재)
- 기록 항목: 호출 시각, **해시 처리된 사용자 ID** (`crypto.createHash('sha256').update(userId + SERVER_SALT).digest('hex').slice(0, 16)`), 호출 출처 (`/trend`, `/source`, `/summarize`), 성공/실패 — 원본 userId는 디스크에 기록하지 않음 (개인정보 보호)
- 쿼터 복원 시: 봇 메모리의 user_id → 해시 변환 → 로그 파일에서 당일 해시 매칭으로 카운트 복원
- `/config gemini_rpd` 값 대비 사용량 비율 기준으로 단계별 알림 (사용자 개인 키 기준):

| 사용량 비율 | 동작 |
|------------|------|
| 80% 도달 | 해당 사용자에게 Ephemeral 경고: `"⚠️ 오늘 Gemini API 사용량 80% 도달 ({n}/{limit} RPD)"` |
| 100% 도달 | 해당 사용자에게 경고 + 이후 요약 기능 자동 차단 (수집 결과만 전송) |
| Gemini 429 응답 | 즉시 해당 사용자에게 경고 + 해당 호출 Fallback 처리 |

- 자정(UTC) 기준 인메모리 카운터 자동 리셋
- `/quota` 명령어로 본인 사용량 즉시 확인 가능
- **재시작 복원:** 봇 기동 시 `logs/gemini_usage_{오늘날짜}.json`에서 사용자별 당일 호출 건수를 읽어 인메모리 카운터를 복원 — 재시작 후에도 `/quota` 수치가 연속성을 유지

**스케줄 자동 실행 (매일 09:00) 키 정책:**
- 서버 키(`GEMINI_API_KEY`)가 없으므로 **요약 없이 수집 결과만 전송**
- 수집 결과 메시지 하단에: `"💡 AI 요약을 보려면 /trend 명령어를 사용해주세요. (개인 API 키 필요)"`

**Fallback 전략:**
- Gemini API 호출 실패 시: 요약 없이 수집 결과만 Discord로 전송
- 입력이 과도하게 클 경우: score 기준 상위 20건만 전달
- `/summarize` 본문 추출 실패 시: `"📄 페이지 본문을 추출할 수 없습니다."` 응답
- Gemini 일일 쿼터 소진 시: 요약 건너뛰고 수집 결과만 전송 + 쿼터 초과 경고 메시지
- 개인 키 미등록 상태에서 `/trend` 호출 시: 수집 결과만 전송 + 키 등록 안내

---

## 8. Discord 메시지 포맷 명세

> **아래는 포맷 예시입니다. 실제 데이터가 아닌 PLACEHOLDER입니다.**

```
📡 TrendLens — {YYYY.MM.DD} ({요일})
━━━━━━━━━━━━━━━━━━━━━━━━━

🔥 오늘의 핵심 3줄 요약
• {핵심 요약 1} — {근거 URL}
• {핵심 요약 2} — {근거 URL}
• {핵심 요약 3} — {근거 URL}

━━━━━━━━━━━━━━━━━━━━━━━━━

📰 Hacker News
• [{점수}pt] {제목} — {URL}
• [{점수}pt] {제목} — {URL}

💬 Reddit
• [r/{서브레딧}] {제목} — {URL}
• [r/{서브레딧}] {제목} — {URL}

⭐ GitHub Trending
• {레포명} — {설명} (★ {stars}) — {URL}
• {레포명} — {설명} (★ {stars}) — {URL}

📄 HuggingFace Papers
• "{논문 제목}" (↑ {upvotes}) — {URL}
• "{논문 제목}" (↑ {upvotes}) — {URL}

━━━━━━━━━━━━━━━━━━━━━━━━━

🤖 AI 트렌드 분석 (by Gemini)
{전체 트렌드 2~3문단 한국어 요약 — 각 주장에 근거 URL 포함}
```

**제약사항:**
- Discord 메시지 2,000자 제한 — 초과 시 분할 전송
- Embed 미사용 (단순성 우선, 일반 텍스트 메시지로 통일)

**분할 전송 전략:**
- 2,000자 초과 시 섹션 단위로 분할 (헤더 → 핵심 요약 → 소스별 → 트렌드 분석)
- 각 메시지는 독립적으로 읽을 수 있도록 섹션 제목 포함
- 분할 순서: ① 핵심 요약 + HN + Reddit ② GitHub + HF + 트렌드 분석
- ⚠️ **절단 방지:** 단순 문자열 슬라이싱(`[:2000]`) 금지 — 마크다운 링크(`[텍스트](URL)`) 중간이 잘려 포맷이 깨질 수 있으므로, 반드시 항목(Item) 또는 개행(`\n`) 단위로 청크 분할

**슬래시 명령어 응답 흐름 (`/trend`, `/source` 공통):**
1. 사용자가 `/trend` 또는 `/source {name}` 입력
2. 봇이 즉시 Deferred 응답: `"🔄 트렌드를 수집 중입니다... (약 10~30초 소요)"` (`interaction.deferReply()`)
3. 백그라운드에서 파이프라인 실행 (수집 → 중복 제거 → 요약 → 포맷)
4. 완료 시 `interaction.editReply()`로 결과 메시지 전송
5. 실패 시 에러 메시지 전송: `"❌ 트렌드 수집에 실패했습니다: {에러 내용}"`

**`/summarize` 응답 흐름:**
1. 사용자가 `/summarize url:{URL}` 입력
2. 봇이 즉시 Deferred 응답: `"🔍 URL을 분석 중입니다... (약 10~20초 소요)"`
3. `fetch`로 URL 요청 → `@extractus/article-extractor`로 본문 추출 → 10,000자 제한 → Gemini 리포트 생성
4. 완료 시 `interaction.editReply()`로 리포트 전송
5. 실패 시 에러 유형별 메시지 전송 (URL 접근 불가 / 본문 추출 실패 / Gemini 실패)

---

## 9. 시스템 아키텍처

```
[Ubuntu Server — 24시간 상시 운영 (systemd)]
              │
       ┌──────┴───────┐
       │   index.js    │  ← discord.js Client (Gateway 연결, 항상 온라인)
       └──────┬───────┘
              │
    ┌─────────┼──────────────────────────────────────────────┐
    │         │                    │                         │
 [자동]    [트렌드]          [키 관리]           [관리/모니터링]     [확장]
 node-cron   /trend, /source  /apikey set       /status, /logs      /summarize
 매일 KST    Deferred 응답    /apikey status     /quota              /config
 요약 생략                     /apikey remove     Ephemeral 응답
    │         │                    │                                 │
    └────┬────┘                    ▼                          ┌──────┘
         │              ┌──────────────────┐                  ▼
         │              │  keyStore.js     │         ┌─────────────────────────┐
         │              │  (인메모리 Map)   │         │ /summarize 흐름          │
         │              │  API 키 + 쿼터   │         │ 키 확인 → fetch           │
         │              └────────┬─────────┘         │ → article-extractor     │
         │                       │                   │ → summarizer            │
         ▼                       │ 개인 키 조회       └────────┬───────────────┘
  ┌──────────────┐               │                            │
  │ pipeline.js  │◄──────────────┘                            │
  └──────┬───────┘                                            │
         │ Promise.allSettled() 병렬 실행                      │
  ┌──────┼─────────┬─────────┐                                │
  ▼      ▼         ▼         ▼                                │
fetchers/ fetchers/ fetchers/ fetchers/                        │
hackernews reddit   github    huggingface                      │
  │        │         │         │                               │
  └────────┼─────────┴─────────┘                               │
           ▼                                                   │
    ┌──────────────┐                                           │
    │  중복 제거    │  ← URL 기반 dedup                         │
    └──────┬───────┘                                           │
           ▼                                                   │
    ┌──────────────┐◄──────────────────────────────────────────┘
    │ summarizer   │  ← 개인 키로 Gemini 호출 (키 없으면 요약 생략)
    └──────┬───────┘
           ▼
    ┌──────────────┐
    │  formatter   │  ← Discord 메시지 빌드
    └──────┬───────┘
           ▼
    ┌──────────────┐
    │  index.js    │  ← channel.send() / interaction.editReply()
    └──────────────┘

[keyStore.js — 인메모리]                ← 개인 API 키 + per-user 쿼터 카운터
[config_override.json]                  ← /config 설정 영속화
[logs/gemini_usage_{date}.json]         ← 쿼터 보조 로그 (디스크)
```

---

## 10. 디렉토리 구조

```
trendlens/
├── .env.example              # 환경변수 템플릿
├── .gitignore
├── package.json              # 의존성 관리 (npm)
├── README.md
├── index.js                  # 진입점 (discord.js Client + 슬래시 명령어 + node-cron 스케줄러)
├── pipeline.js               # 파이프라인 오케스트레이터
├── config.js                 # 설정값 중앙 관리 (기본값 + config_override.json 로드)
├── fetchers/
│   ├── hackernews.js         # HN Algolia API
│   ├── reddit.js             # Reddit JSON API
│   ├── github-trending.js    # GitHub Trending 스크래핑 (cheerio)
│   └── huggingface.js        # HF Daily Papers API
├── keyStore.js               # 개인 API 키 인메모리 관리 + per-user 쿼터 카운터
├── summarizer.js             # Gemini 요약 (트렌드 요약 + /summarize URL 리포트)
├── formatter.js              # Discord 메시지 포맷 빌더
├── config_override.json      # /config로 변경된 설정 저장 (자동 생성, .gitignore 대상)
├── logs/                     # 실행 결과 JSON 로그 + Gemini 사용량 추적 (자동 생성)
└── trendlens.service         # systemd 유닛 파일
```

---

## 11. 환경변수 명세

| 변수명 | 필수 | 설명 | 발급처 |
|--------|------|------|--------|
| `DISCORD_BOT_TOKEN` | O | Discord 봇 인증 토큰 | [Discord Developer Portal](https://discord.com/developers/applications) > Bot > Token |
| `DISCORD_GUILD_ID` | O | 슬래시 명령어를 등록할 서버(Guild) ID | Discord 서버 우클릭 > ID 복사 (개발자 모드 필요) |
| `REDDIT_CLIENT_ID` | X | Reddit OAuth 앱 ID (권장) | [reddit.com/prefs/apps](https://www.reddit.com/prefs/apps) |
| `REDDIT_CLIENT_SECRET` | X | Reddit OAuth 앱 Secret (권장) | 위와 동일 |

> **참고:** `GEMINI_API_KEY`는 서버 환경변수에 설정하지 않습니다. 각 사용자가 `/apikey set` 명령어로 본인의 API 키를 등록합니다. 키는 봇 메모리에만 보관되며 디스크에 저장되지 않습니다.

**Discord 봇 생성 절차:**
1. [Discord Developer Portal](https://discord.com/developers/applications)에서 New Application 생성
2. Bot 탭에서 Token 발급 → `DISCORD_BOT_TOKEN`에 설정
3. OAuth2 > URL Generator에서 `bot` + `applications.commands` 스코프 선택
4. Bot Permissions: `Send Messages`, `Attach Files`, `Use Slash Commands` 체크
5. 생성된 URL로 서버에 봇 초대

**서버 환경변수 설정:**
- `.env` 파일에 작성 (`dotenv`로 로드)
- 또는 systemd 유닛 파일의 `EnvironmentFile`로 지정

---

## 12. 기술 스택

| 라이브러리 | 용도 |
|-----------|------|
| `discord.js` | Discord 봇 (Gateway 연결, 슬래시 명령어, 메시지 전송) |
| `node-cron` | 매일 09:00 KST 자동 스케줄링 |
| `cheerio` | GitHub Trending HTML 파싱 |
| `@google/generative-ai` | Gemini API 호출 |
| `@extractus/article-extractor` | 웹페이지 본문 추출 (`/summarize` 명령어) |
| `dotenv` | .env 파일 로드 |
| `winston` | 구조화 로깅 (레벨별 출력, 파일 로그) |

> **참고:** HTTP 요청은 Node.js 18+ 내장 `fetch`를 사용하므로 별도 HTTP 클라이언트 라이브러리가 불필요합니다.

---

## 13. 에러 핸들링 명세

| 상황 | 처리 방식 |
|------|----------|
| 파이프라인 동시 실행 시도 | `isRunning` 플래그 체크 시 즉시 `"🔄 현재 트렌드 수집이 진행 중입니다."` 응답 후 종료 |
| 개인 키 미등록 (`/trend`, `/source`) | 수집 결과만 전송 (요약 생략) + 키 등록 안내 메시지 |
| 개인 키 미등록 (`/summarize`) | 즉시 거부 + 키 등록 안내 메시지 |
| 개인 키 유효하지 않음 (런타임) | 요약 없이 수집 결과만 전송 + `"❌ API 키가 만료되었거나 유효하지 않습니다. /apikey set으로 재등록해주세요."` |
| 스케줄 자동 실행 (09:00) | 요약 없이 수집 결과만 전송 (서버 키 없음) |
| 개별 소스 수집 실패 | 해당 소스 건너뛰고, 나머지로 진행 |
| 전체 수집 결과 0건 | Discord에 "수집 결과 없음" 메시지 전송 |
| Gemini API 호출 실패 | 요약 없이 수집 결과만 전송 |
| Gemini 일일 쿼터 소진 | 요약 건너뛰기 + Discord 쿼터 초과 경고 전송 |
| Discord API 전송 실패 | 최대 3회 재시도 (exponential backoff) |
| 봇 프로세스 크래시 | systemd `Restart=on-failure`로 자동 재시작 |
| Discord Gateway 연결 끊김 | discord.js 내장 자동 재연결 |

**로깅 전략:**
- `winston` 라이브러리 사용 (레벨: `info` 기본, `debug` 선택)
- stdout + 파일 로그 병행 (`logs/` 디렉토리)
- systemd 환경에서 `journalctl -u trendlens`로 확인 가능
- `/logs` 슬래시 명령어로 원격 로그 조회 가능 (관리자 전용, SSH 불필요)
- **민감정보 로깅 금지:** `Authorization` 헤더, API 키, 쿠키, 환경변수 값은 로그에 절대 기록하지 않음 — 에러 스택 출력 시에도 마스킹 처리

| 로그 항목 | 레벨 | 예시 |
|-----------|------|------|
| 파이프라인 시작/종료 | `info` | `Pipeline started at 2026-02-26 00:00:00 UTC` |
| 소스별 수집 건수 | `info` | `[HackerNews] 8건 수집 (소요: 1.2s)` |
| 소스 수집 실패 | `warn` | `[Reddit] 수집 실패: 429 Too Many Requests` |
| 중복 제거 결과 | `info` | `중복 제거: 35건 → 28건` |
| API 키 등록/삭제 | `info` | `[KeyStore] user:123456 키 등록 (키 값 로깅 금지)` |
| API 키 검증 실패 | `warn` | `[KeyStore] user:123456 키 검증 실패 — 유효하지 않은 키` |
| Gemini 호출 결과 | `info` | `[user:123456] 요약 생성 완료 (입력: 28건, 소요: 3.5s)` |
| Gemini 쿼터 상태 | `info` | `[user:123456] Gemini API 사용량: 3/50 RPD (6%)` |
| Gemini 쿼터 경고 | `warn` | `[user:123456] Gemini API 사용량 80% 도달 (40/50 RPD)` |
| Gemini 429 응답 | `error` | `[user:123456] Gemini API rate limit 초과 — Fallback 처리` |
| 요약 생략 (키 미등록) | `info` | `요약 생략: 개인 키 미등록 (스케줄 자동 실행 or 사용자 미등록)` |
| Discord 전송 결과 | `info` | `Discord 전송 성공 (메시지 2건)` |

**실행 결과 로그 (F-07):**
- 매 실행 시 아래 메타데이터를 `logs/result_{YYYY-MM-DD}.json`으로 저장
- 보관: 로컬 파일 시스템에 누적 (아래 로그 로테이션 정책 적용)

```json
{
  "executed_at": "2026-02-26T00:00:00Z",
  "sources": {
    "hackernews": {"collected": 8, "elapsed_sec": 1.2},
    "reddit": {"collected": 12, "elapsed_sec": 3.1},
    "github": {"collected": 5, "elapsed_sec": 0.8},
    "huggingface": {"collected": 5, "elapsed_sec": 0.6}
  },
  "after_dedup": 25,
  "triggered_by": "schedule | /trend | /source",
  "user_id": null,
  "gemini_used": false,
  "gemini_skip_reason": "no_personal_key | quota_exceeded | api_error | null",
  "discord_messages_sent": 2,
  "errors": []
}
```

**로그 로테이션 정책:**
- `logs/` 디렉토리 내 파일은 **30일 보관** 후 자동 삭제
- 봇 기동 시 및 매일 자정(UTC) 스케줄에서 `logs/` 디렉토리를 스캔하여 30일 초과 파일 삭제
- 삭제 대상: `result_*.json`, `gemini_usage_*.json`, `last_restart_notice.txt` (재시작 공지 파일은 항상 최신 1개만 유지)
- 구현: `fs.readdirSync()` + `Date` 비교로 파일명의 날짜 파싱 → 30일 초과 시 `fs.unlinkSync()`

```javascript
const fs = require('node:fs');
const path = require('node:path');

function cleanupOldLogs(logsDir, retentionDays = 30) {
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const patterns = [/^result_(.+)\.json$/, /^gemini_usage_(.+)\.json$/];
  for (const file of fs.readdirSync(logsDir)) {
    for (const re of patterns) {
      const match = file.match(re);
      if (match && new Date(match[1]).getTime() < cutoff) {
        try { fs.unlinkSync(path.join(logsDir, file)); } catch {}
      }
    }
  }
}
```

---

## 14. 비용 추산

| 항목 | 비용 | 비고 |
|------|------|------|
| Gemini 2.5 Flash | 각 사용자 부담 | 사용자별 개인 키 사용 (무료 tier 활용) |
| Ubuntu 서버 (기존 보유) | 0원 | |
| Discord Bot | 0원 | |
| HackerNews Algolia API | 0원 | |
| Reddit JSON API | 0원 | |
| GitHub Trending 스크래핑 | 0원 | |
| HuggingFace Daily Papers API | 0원 | |
| **서버 운영 비용** | **0원** | Gemini 비용은 각 사용자의 개인 키/계정에 귀속 |

**비용 관련 안내 (사용자 대상):**
- Gemini: 무료 쿼터는 계정/프로젝트/시점에 따라 변동 가능 → [AI Studio 콘솔](https://aistudio.google.com)에서 본인 할당량 확인 — **AI Studio에 표시된 값이 소스 오브 트루스(Source of Truth)**, 봇 내부 카운터는 보조 지표
- `/trend` + `/summarize` 명령어를 빈번하게 사용할 경우 개인 Gemini RPD 한도에 도달할 수 있음 (`/trend` 1 RPD + `/summarize` 건당 1 RPD)
- `/quota` 명령어로 본인 사용량을 모니터링하고, 80% 도달 시 경고를 받을 수 있음
- 스케줄 자동 실행(09:00)은 수집만 수행하므로 Gemini 쿼터를 소모하지 않음
- Reddit OAuth 전환 시: API 자체는 무료이나 앱 등록 필요

---

## 15. 개발 순서 (1.5일 타임라인, 약 12시간)

| 순서 | 시간 | 작업 |
|------|------|------|
| 1 | 1시간 | 프로젝트 셋업 (.gitignore, package.json, .env.example, config.js) |
| 2 | 2~3시간 | fetchers 4개 모듈 구현 + 개별 테스트 |
| 3 | 30분 | 중복 제거 로직 (pipeline.js 내 구현) |
| 4 | 1시간 | keyStore.js (인메모리 키 관리 + per-user 쿼터 카운터) |
| 5 | 1.5시간 | summarizer.js (Gemini 연동 + 개인 키 기반 호출 + 쿼터 추적/알림) |
| 6 | 30분 | formatter.js (메시지 포맷 빌더) |
| 7 | 2시간 | index.js — `/trend`, `/source`, `/apikey`, `/status`, `/logs`, `/quota` 명령어 + node-cron 스케줄러 |
| 8 | 1시간 | `/summarize` 명령어 (개인 키 확인 + article-extractor 본문 추출 + Gemini 리포트) |
| 9 | 1시간 | `/config` 명령어 (6개 설정 항목 + config_override.json 영속화) |
| 10 | 1시간 | pipeline.js 통합 + E2E 테스트 |
| 11 | 30분 | systemd 서비스 등록 + 서버 배포 |

---

## 16. 테스트 전략

### 16-1. 단위 테스트

| 대상 | 테스트 방법 | 도구 |
|------|-----------|------|
| 각 fetcher 모듈 | API 응답 mock 후 파싱 로직 검증 | `vitest` + `msw` (Mock Service Worker) |
| 중복 제거 로직 | 동일 URL 항목 입력 시 제거 확인 | `vitest` |
| formatter | 입력 데이터 → 포맷된 메시지 문자열 검증 | `vitest` |
| 메시지 분할 | 2,000자 초과 입력 시 분할 동작 검증 | `vitest` |

### 16-2. 통합 테스트

| 시나리오 | 검증 항목 |
|----------|----------|
| 전체 파이프라인 실행 | 수집 → 중복 제거 → 요약 → 포맷 → 전송 정상 동작 |
| 부분 소스 실패 | 1개 소스 실패 시 나머지로 정상 완료 |
| 전체 소스 실패 | "수집 결과 없음" 메시지 전송 확인 |

### 16-3. 수동 검증

```bash
# 봇 실행 (로컬 테스트)
node index.js

# 개별 fetcher 테스트
node -e "require('./fetchers/hackernews').fetch().then(console.log)"
node -e "require('./fetchers/reddit').fetch().then(console.log)"
node -e "require('./fetchers/github-trending').fetch().then(console.log)"
node -e "require('./fetchers/huggingface').fetch().then(console.log)"

# 파이프라인 단독 테스트 (봇 없이)
node -e "require('./pipeline').runPipeline().then(console.log)"
```

---

## 17. 배포 및 운영

### 17-0. 초기 셋업 절차

```bash
# 1. 프로젝트 클론
git clone https://github.com/{username}/trendlens.git
cd trendlens

# 2. 의존성 설치 (Node.js 18+ 필요)
npm install

# 3. 환경변수 설정
cp .env.example .env
# .env 파일을 편집하여 아래 값 설정:
#   DISCORD_BOT_TOKEN=...
#   DISCORD_GUILD_ID=...
#   REDDIT_CLIENT_ID=... (선택)
#   REDDIT_CLIENT_SECRET=... (선택)

# 4. 로그 디렉토리 생성
mkdir -p logs

# 5. 로컬 실행 테스트
node index.js
```

### 17-1. systemd 서비스 등록

```ini
# trendlens.service
[Unit]
Description=TrendLens Discord Bot
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/trendlens
EnvironmentFile=/home/ubuntu/trendlens/.env
ExecStart=/usr/bin/node /home/ubuntu/trendlens/index.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

### 17-2. 서비스 관리 명령어

```bash
# 서비스 등록 및 시작
sudo cp trendlens.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable trendlens
sudo systemctl start trendlens

# 상태 확인
sudo systemctl status trendlens

# 로그 확인
sudo journalctl -u trendlens -f

# 재시작 / 중지
sudo systemctl restart trendlens
sudo systemctl stop trendlens
```

### 17-3. 봇 업데이트 절차

```bash
cd /home/ubuntu/trendlens
git pull origin main
npm install
sudo systemctl restart trendlens
```
