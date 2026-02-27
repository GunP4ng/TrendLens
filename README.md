# TrendLens 🔭

> AI 트렌드를 매일 수집·요약하여 Discord 채널에 전송하는 자동화 봇

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-5865F2?logo=discord&logoColor=white)](https://discord.js.org)
[![Gemini](https://img.shields.io/badge/Gemini-AI-4285F4?logo=google&logoColor=white)](https://ai.google.dev)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Features

| 기능 | 설명 |
|------|------|
| **멀티 서버 지원** | 여러 Discord 서버에 동시 설치 가능. 서버별 독립적인 채널·소스·API 키 관리 |
| **서버 공유 API 키** | 서버 관리자가 Gemini API 키를 한 번만 등록하면 서버 모든 멤버가 AI 요약 기능을 사용 |
| **멀티 소스 수집** | HackerNews · Reddit · GitHub Trending · HuggingFace Papers 4곳에서 최신 트렌드를 동시 수집 |
| **AI 한국어 요약** | 서버 Gemini API 키로 핵심 3줄 요약 + 트렌드 분석을 한국어로 생성 (키 없으면 요약 생략 안내) |
| **자동 스케줄링** | `node-cron` 기반 서버별 매일 정해진 시간에 트렌드 자동 전송 |
| **슬래시 명령어** | Discord 네이티브 `/` 명령어로 온디맨드 조회 및 봇 설정 관리 |
| **서버 Reddit OAuth** | 서버 단위 Reddit OAuth 등록으로 안정적인 수집 (관리자 등록) |
| **SSRF 방어** | IPv4/IPv6, A/AAAA, IP literal 검사로 내부망 접근 차단 |
| **멘션 안전화** | 외부 콘텐츠 전송 시 `allowedMentions` 차단으로 무분별한 ping 방지 |
| **품질 게이트** | `lint + typecheck + test` 빌드 검증 및 GitHub Actions CI 제공 |

---

## Prerequisites

- **Node.js** 18 이상
- **Discord Bot Token** ([Discord Developer Portal](https://discord.com/developers/applications))
  - OAuth2 스코프: `bot`, `applications.commands` 필수
  - 봇 권한: `Send Messages`, `Read Message History`
- _(선택)_ **Gemini API Key** — 서버 관리자가 `/apikey set`으로 등록. 미등록 시 링크 중심 결과 + 요약 생략 안내
- _(선택)_ **Reddit OAuth Credentials** — 서버 관리자가 `/reddit login`으로 등록. 미등록 시 비인증 모드로 동작

---

## Quick Start

```bash
# 1. 저장소 클론
git clone https://github.com/yourname/trendlens.git
cd trendlens

# 2. 패키지 설치
npm install

# 3. 환경변수 설정
cp .env.example .env
# .env 파일을 편집하여 DISCORD_BOT_TOKEN 입력

# 4. 봇 실행
npm start
```

봇이 실행되면 Discord 서버에서 아래 순서로 초기 설정합니다 **(관리자 계정 필요)**:

```
/config channel #채널-이름   → 트렌드 수신 채널 지정
/apikey set <Gemini-API-키>  → 서버 Gemini API 키 등록 (관리자 전용)
/trend                        → 즉시 트렌드 조회 테스트
```

API 키 등록 후에는 **서버 전체 멤버**가 `/trend`, `/source` 명령어를 사용할 수 있습니다.

---

## Commands

### 트렌드 조회

| 명령어 | 설명 |
|--------|------|
| `/trend` | 전체 소스 최신 트렌드 즉시 조회 (AI 요약 포함, 서버 API 키 필요) |
| `/trend date:<YYYY-MM-DD>` | 특정 날짜 트렌드 조회 |
| `/source url:<URL>` | URL 단건 AI 분석 리포트 생성 (서버 API 키 필요) |

### API 키 관리

| 명령어 | 권한 | 설명 |
|--------|:----:|------|
| `/apikey set <key>` | 관리자 | 서버 Gemini API 키 등록. 이 서버 모든 멤버가 사용 |
| `/apikey status` | 전체 | 서버 키 등록 상태 및 오늘 사용량 확인 |
| `/apikey remove` | 관리자 | 서버 API 키 삭제 |

### Reddit 인증

| 명령어 | 권한 | 설명 |
|--------|:----:|------|
| `/reddit login <client_id> <client_secret>` | 관리자 | 서버 Reddit OAuth 자격증명 등록 |
| `/reddit status` | 전체 | 서버 인증 상태 확인 |
| `/reddit remove` | 관리자 | 서버 인증 정보 삭제 |

### 봇 설정 (관리자 전용)

| 명령어 | 설명 |
|--------|------|
| `/config channel <채널>` | 자동 전송 채널 지정 |
| `/config time <HH:MM>` | 자동 전송 시간 변경 (기본 `09:00` KST) |
| `/config sources <소스> <ON\|OFF>` | 소스별 활성화/비활성화 토글 |
| `/config cooldown <초>` | 명령어 쿨다운 설정 (60~600초, 기본 300초) |
| `/config language <언어>` | 요약 언어 변경 (한국어 / English) |
| `/config gemini_rpd <한도>` | Gemini 일일 쿼터 한도 설정 (10~500, 기본 50) |

### 정보 및 모니터링

| 명령어 | 설명 |
|--------|------|
| `/help` | 전체 명령어 목록 및 사용법 |
| `/status` | 봇 상태, 업타임, 채널, 소스 설정 요약 |
| `/quota` | 서버 Gemini API 오늘 사용량 확인 |
| `/logs` | 오늘의 실행 로그 조회 (관리자 전용, KST 기준 파일) |

---

## Project Structure

```
trendlens/
├── src/
│   ├── index.js            # 봇 진입점, Discord 이벤트 & 명령어 핸들러
│   ├── pipeline.js         # 수집 → 정규화 → 중복제거 → 요약 파이프라인
│   ├── config.js           # 서버별 설정 (data/guild_configs/{guildId}.json)
│   ├── keyStore.js         # 서버별 Gemini API 키 & Reddit OAuth 인메모리 저장소
│   ├── summarizer.js       # Gemini API 호출 & 프롬프트 빌더
│   ├── formatter.js        # Discord 메시지 포맷터
│   ├── urlUtils.js         # URL 정규화 & 중복 제거 유틸
│   ├── logger.js           # Winston 로거 (민감정보 마스킹 포함)
│   └── fetchers/
│       ├── hackernews.js   # HackerNews Algolia API
│       ├── reddit.js       # Reddit OAuth REST API
│       ├── github-trending.js  # GitHub Trending 스크래핑 + Search API 폴백
│       └── huggingface.js  # HuggingFace Daily Papers API
├── tests/
│   ├── config.test.js
│   ├── fetchers.test.js
│   ├── formatter.test.js
│   ├── keyStore.test.js
│   ├── pipeline.test.js
│   └── summarizer.test.js
├── .github/
│   └── workflows/
│       └── ci.yml            # lint/typecheck/test 자동 검증
├── deploy/
│   └── trendlens.service   # systemd 서비스 유닛 파일
├── data/                   # 런타임 서버별 설정 (gitignore)
│   └── guild_configs/      # {guildId}.json — 서버별 채널, 소스, 스케줄 등
├── logs/                   # 런타임 로그 & Gemini 사용량 (gitignore)
├── .env.example
├── eslint.config.cjs
├── package.json
└── vitest.config.mjs
```

---

## Configuration

### 환경변수 (`.env`)

| 변수 | 필수 | 설명 |
|------|:----:|------|
| `DISCORD_BOT_TOKEN` | ✅ | Discord 봇 토큰 |
| `DISCORD_GUILD_ID` | ❌ | 개발용: 특정 서버에만 명령어 등록 (즉시 반영). 생략 시 전역 등록 (최대 1시간 전파) |

### 런타임 설정 (`/config` 명령어)

런타임 설정은 `data/guild_configs/{guildId}.json`에 서버별로 자동 저장되어 봇 재시작 후에도 유지됩니다.

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `channel` | 미설정 | 자동 전송 채널 ID |
| `time` | `09:00` | 자동 전송 시간 (HH:MM, KST 기준) |
| `sources` | 전체 활성 | 수집 소스별 활성화 여부 (hackernews/reddit/github/huggingface) |
| `cooldown` | `300` | 명령어 쿨다운 (초) |
| `language` | `ko` | 요약 언어 (`ko` / `en`) |
| `geminiRpd` | `50` | 서버별 Gemini API 일일 요청 한도 |

---

## Deployment

Ubuntu 서버에 systemd 서비스로 등록하여 자동 시작 및 크래시 복구를 설정합니다.

```bash
# 1. 파일 복사
sudo cp deploy/trendlens.service /etc/systemd/system/

# 2. ExecStart 경로 확인 후 서비스 등록
sudo systemctl daemon-reload
sudo systemctl enable trendlens
sudo systemctl start trendlens

# 서비스 관리
sudo systemctl status trendlens    # 상태 확인
sudo systemctl restart trendlens   # 재시작
sudo journalctl -u trendlens -f    # 실시간 로그
```

`deploy/trendlens.service`의 `WorkingDirectory`와 `ExecStart` 경로를 실제 서버 경로에 맞게 수정하세요.

> `data/guild_configs/` 및 `logs/` 디렉토리는 서비스 시작 시 자동 생성됩니다.

### Discord Developer Portal 설정

1. [Discord Developer Portal](https://discord.com/developers/applications)에서 봇 생성
2. **OAuth2 → URL Generator**: 스코프 `bot`, `applications.commands` 선택
3. 봇 권한: `Send Messages`, `Read Message History`, `Attach Files` 선택
4. 생성된 초대 URL로 각 서버에 봇 초대

---

## Testing

```bash
# 정적 분석
npm run lint

# 문법 기반 타입/구문 검증
npm run typecheck

# 전체 단위 테스트 실행
npm test

# 전체 품질 게이트 (lint + typecheck + test)
npm run build

# 운영 의존성 취약점 점검
npm audit --omit=dev

# 특정 테스트 파일만 실행
npx vitest run tests/formatter.test.js

# 개별 fetcher 수동 테스트 (Node.js REPL)
node -e "require('./src/fetchers/hackernews').fetch().then(r => console.log(r.slice(0,2)))"
node -e "require('./src/fetchers/huggingface').fetch().then(r => console.log(r.slice(0,2)))"
node -e "require('./src/fetchers/github-trending').fetch().then(r => console.log(r.slice(0,2)))"
```

## CI

- GitHub Actions: `.github/workflows/ci.yml`
- 트리거: `main`, `master` 브랜치 push 및 모든 Pull Request
- 실행 항목: `npm ci` → `npm run build`

## Git Workflow (preview -> main)

- `main`에는 직접 commit 하지 않습니다.
- 모든 변경은 `preview`에서 commit 하고 `main`은 fast-forward merge로만 반영합니다.

```bash
# 1) 작업 브랜치에서 커밋
git switch preview
git add .
git commit -m "feat: multi-guild server-level API key support"
git push -u origin preview

# 2) main은 ff-only로 반영
git switch main
git pull --ff-only origin main
git merge --ff-only preview
git push origin main
```

---

## Tech Stack

| 패키지 | 버전 | 용도 |
|--------|------|------|
| [discord.js](https://discord.js.org) | ^14 | Discord Bot API 클라이언트 |
| [@google/generative-ai](https://ai.google.dev) | ^0.21 | Gemini AI 요약 |
| [node-cron](https://github.com/node-cron/node-cron) | ^3 | 자동 스케줄링 |
| [cheerio](https://cheerio.js.org) | ^1 | GitHub Trending HTML 파싱 |
| [@extractus/article-extractor](https://github.com/extractus/article-extractor) | ^8 | URL 본문 추출 |
| [winston](https://github.com/winstonjs/winston) | ^3 | 구조화 로깅 |
| [dotenv](https://github.com/motdotla/dotenv) | ^16 | 환경변수 로드 |
| [vitest](https://vitest.dev) | ^3 | 단위 테스트 |
| [msw](https://mswjs.io) | ^2 | API 모킹 (테스트용) |

---

## License

[MIT](LICENSE)
