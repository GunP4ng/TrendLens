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
| **멀티 소스 수집** | HackerNews · Reddit · GitHub Trending · HuggingFace Papers 4곳에서 최신 트렌드를 동시 수집 |
| **AI 한국어 요약** | 사용자별 Gemini API 키로 핵심 3줄 요약 + 트렌드 분석을 한국어로 생성 |
| **자동 스케줄링** | `node-cron` 기반 매일 정해진 시간에 설정 채널로 자동 전송 |
| **슬래시 명령어** | Discord 네이티브 `/` 명령어로 온디맨드 조회 및 봇 설정 관리 |
| **개인 Reddit OAuth** | 사용자별 Reddit 계정 로그인으로 개인화된 피드 수집 |
| **SSRF 방어** | 내부 IP·루프백 주소 요청 차단으로 서버 보안 강화 |

---

## Prerequisites

- **Node.js** 18 이상
- **Discord Bot Token** + **Guild ID** ([Discord Developer Portal](https://discord.com/developers/applications))
- _(선택)_ **Gemini API Key** — 사용자별 `/apikey set` 명령어로 등록
- _(선택)_ **Reddit OAuth Credentials** — `client_id`, `client_secret`, `refresh_token`

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
# .env 파일을 편집하여 DISCORD_BOT_TOKEN, DISCORD_GUILD_ID 입력

# 4. 봇 실행
npm start
```

봇이 실행되면 Discord 서버에서 아래 순서로 초기 설정합니다:

```
/config channel #채널-이름   → 트렌드 수신 채널 지정
/apikey set <Gemini-API-키>  → 개인 Gemini API 키 등록
/trend                        → 즉시 트렌드 조회 테스트
```

---

## Commands

### 트렌드 조회

| 명령어 | 설명 |
|--------|------|
| `/trend` | 전체 소스 최신 트렌드 즉시 조회 |
| `/trend sources:hackernews` | 특정 소스만 조회 (hn / reddit / github / huggingface) |
| `/trend limit:5` | 소스당 항목 수 지정 (기본 5, 최대 20) |
| `/source <url>` | 특정 URL 단건 AI 요약 |
| `/summarize <text>` | 직접 입력한 텍스트 AI 요약 |

### API 키 관리

| 명령어 | 설명 |
|--------|------|
| `/apikey set <key>` | Gemini API 키 등록 (본인에게만 보이는 응답) |
| `/apikey status` | 등록된 키 상태 및 사용량 확인 |
| `/apikey remove` | 등록된 키 삭제 |

### Reddit 인증

| 명령어 | 설명 |
|--------|------|
| `/reddit login` | Reddit OAuth 자격증명 등록 |
| `/reddit status` | 인증 상태 확인 |
| `/reddit logout` | 인증 정보 삭제 |

### 봇 설정

| 명령어 | 설명 |
|--------|------|
| `/config channel <채널>` | 자동 전송 채널 지정 |
| `/config schedule <cron>` | 자동 전송 스케줄 변경 (기본 `0 9 * * *`) |
| `/config sources <소스>` | 활성화 소스 토글 |
| `/config show` | 현재 설정 전체 표시 |

### 정보

| 명령어 | 설명 |
|--------|------|
| `/help` | 전체 명령어 목록 및 사용법 |
| `/status` | 봇 상태, 업타임, 설정 요약 |

---

## Project Structure

```
trendlens/
├── src/
│   ├── index.js            # 봇 진입점, Discord 이벤트 & 명령어 핸들러
│   ├── pipeline.js         # 수집 → 정규화 → 중복제거 → 요약 파이프라인
│   ├── config.js           # 설정 로드 & config_override.json 영속화
│   ├── keyStore.js         # Gemini API 키 & Reddit OAuth 인메모리 저장소
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
│   ├── formatter.test.js
│   ├── keyStore.test.js
│   └── pipeline.test.js
├── deploy/
│   └── trendlens.service   # systemd 서비스 유닛 파일
├── logs/                   # 런타임 로그 & Gemini 사용량 (gitignore)
├── .env.example
├── package.json
└── vitest.config.js
```

---

## Configuration

### 환경변수 (`.env`)

| 변수 | 필수 | 설명 |
|------|:----:|------|
| `DISCORD_BOT_TOKEN` | ✅ | Discord 봇 토큰 |
| `DISCORD_GUILD_ID` | ✅ | 슬래시 명령어를 등록할 서버 ID |

### 런타임 설정 (`/config` 명령어)

런타임 설정은 `config_override.json`에 자동 저장되어 봇 재시작 후에도 유지됩니다.

| 설정 | 기본값 | 설명 |
|------|--------|------|
| `channel` | 미설정 | 자동 전송 채널 ID |
| `schedule` | `0 9 * * *` | 자동 전송 크론 스케줄 (매일 오전 9시 KST) |
| `sources` | 전체 활성 | 수집 소스 활성화 목록 |
| `limitPerSource` | `5` | 소스당 항목 수 |

> 자세한 요구사항 명세는 [BUILD_TEXT.md](BUILD_TEXT.md)를 참고하세요.

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

---

## Testing

```bash
# 전체 단위 테스트 실행
npm test

# 특정 테스트 파일만 실행
npx vitest run tests/formatter.test.js

# 개별 fetcher 수동 테스트 (Node.js REPL)
node -e "require('./src/fetchers/hackernews').fetch().then(r => console.log(r.slice(0,2)))"
node -e "require('./src/fetchers/huggingface').fetch().then(r => console.log(r.slice(0,2)))"
node -e "require('./src/fetchers/github-trending').fetch().then(r => console.log(r.slice(0,2)))"
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
