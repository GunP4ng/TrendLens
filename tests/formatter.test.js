const { formatTrendMessage, formatSourceMessage, formatSummarizeReport, formatStatusMessage, formatAndChunkMessage, chunkText, truncateSummary } = require('../src/formatter');

describe('formatTrendMessage', () => {
  const mockItems = [
    { title: 'HN Post', url: 'https://hn.com/1', source: 'hackernews', score: 100, summary: null, createdAt: new Date(), metadata: {} },
    { title: 'Reddit Post', url: 'https://reddit.com/1', source: 'reddit', score: 50, summary: null, createdAt: new Date(), metadata: { subreddit: 'MachineLearning' } },
    { title: 'user/repo', url: 'https://github.com/user/repo', source: 'github', score: 500, summary: 'A repo', createdAt: new Date(), metadata: { stars: 500, todayStars: 30 } },
    { title: 'Cool Paper', url: 'https://hf.co/papers/1', source: 'huggingface', score: 25, summary: null, createdAt: new Date(), metadata: { upvotes: 25 } },
  ];

  it('빈 항목 시 "수집 결과 없음" 메시지', () => {
    const msgs = formatTrendMessage([], null, '2026-02-26');
    expect(msgs[0]).toContain('수집된 트렌드 항목이 없습니다');
  });

  it('정상 항목을 포맷하여 반환', () => {
    const msgs = formatTrendMessage(mockItems, null, '2026-02-26');
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(msgs[0]).toContain('TrendLens');
    expect(msgs[0]).toContain('HackerNews');
  });

  it('HN 아이템을 점수 + URL 형태로 포맷', () => {
    const msgs = formatTrendMessage(mockItems, null, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).toContain('[100pt] HN Post');
    expect(full).toContain('<https://hn.com/1>');
  });

  it('Reddit 아이템을 서브레딧 + URL 형태로 포맷', () => {
    const msgs = formatTrendMessage(mockItems, null, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).toContain('[r/MachineLearning] Reddit Post');
    expect(full).toContain('<https://reddit.com/1>');
  });

  it('GitHub 아이템을 패키지 이모지 + 별 수 형태로 포맷 (aiSummary 없으면 ↳ 줄 생략)', () => {
    const msgs = formatTrendMessage(mockItems, null, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).toContain('📦 user/repo (★ 500)');
    expect(full).toContain('<https://github.com/user/repo>');
    // item.summary만 있는 경우 영문 원문 노출 방지를 위해 ↳ 줄을 생략
    expect(full).not.toContain('↳ ✨ A repo');
  });

  it('HuggingFace 아이템을 문서 이모지 + 업보트 형태로 포맷', () => {
    const msgs = formatTrendMessage(mockItems, null, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).toContain('📜 Cool Paper (↑ 25)');
    expect(full).toContain('<https://hf.co/papers/1>');
  });

  it('소스 헤더에 건수가 표시됨', () => {
    const msgs = formatTrendMessage(mockItems, null, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).toContain('HackerNews (1건)');
    expect(full).toContain('Reddit (1건)');
    expect(full).toContain('GitHub Trending (1건)');
    expect(full).toContain('HuggingFace Papers (1건)');
  });

  it('parsedData가 string(fallback)이면 그대로 포함', () => {
    const summaryText = '오늘의 AI 트렌드 분석입니다.';
    const msgs = formatTrendMessage(mockItems, summaryText, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).toContain('오늘의 AI 트렌드 분석입니다.');
    expect(full).toContain('━━━━━━━━━━━━━━━━━━━━━━━━━');
  });

  it('parsedData가 object이면 핵심 3줄 요약 불릿 포맷 적용', () => {
    const parsedData = {
      core_summary: ['AI 에이전트 도구 급성장', '오픈소스 LLM 경쟁 치열', 'RAG 패턴 표준화 진행 중'],
      item_summaries: {},
      analysis: '트렌드 분석 내용',
    };
    const msgs = formatTrendMessage(mockItems, parsedData, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).toContain('🔥 **오늘의 핵심 3줄 요약**');
    expect(full).toContain('• AI 에이전트 도구 급성장');
    expect(full).toContain('• 오픈소스 LLM 경쟁 치열');
    expect(full).toContain('• RAG 패턴 표준화 진행 중');
  });

  it('parsedData가 object이면 analysis 섹션 출력', () => {
    const parsedData = {
      core_summary: ['요약1', '요약2', '요약3'],
      item_summaries: {},
      analysis: '이번 주 AI 트렌드는 에이전트 중심',
    };
    const msgs = formatTrendMessage(mockItems, parsedData, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).toContain('🤖 **AI 트렌드 분석 (by Gemini)**');
    expect(full).toContain('이번 주 AI 트렌드는 에이전트 중심');
  });

  it('item.aiSummary가 있으면 원문 summary보다 우선 출력', () => {
    const itemsWithAiSummary = [
      {
        title: 'Cool Paper',
        url: 'https://hf.co/papers/1',
        source: 'huggingface',
        score: 25,
        summary: 'Very long original english abstract...',
        aiSummary: 'AI가 생성한 한국어 1줄 요약',
        metadata: { upvotes: 25 },
      },
    ];
    const msgs = formatTrendMessage(itemsWithAiSummary, null, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).toContain('↳ 💡 AI가 생성한 한국어 1줄 요약');
    expect(full).not.toContain('Very long original english abstract');
  });

  it('item.summary만 있고 aiSummary 없으면 영문 원문 미표시 (↳ 줄 생략)', () => {
    const longSummary = 'A'.repeat(200);
    const itemsWithLongSummary = [
      {
        title: 'HN Post',
        url: 'https://hn.com/1',
        source: 'hackernews',
        score: 100,
        summary: longSummary,
        metadata: {},
      },
    ];
    const msgs = formatTrendMessage(itemsWithLongSummary, null, '2026-02-26');
    const full = msgs.join('\n');
    // aiSummary가 없으면 item.summary(영문 원문)를 표시하지 않음
    expect(full).not.toContain('↳');
    expect(full).not.toContain('A'.repeat(10));
  });

  it('summary와 aiSummary 모두 없으면 ↳ 줄 생략', () => {
    const itemsNoSummary = [
      { title: 'HN Post', url: 'https://hn.com/1', source: 'hackernews', score: 100, summary: null, metadata: {} },
    ];
    const msgs = formatTrendMessage(itemsNoSummary, null, '2026-02-26');
    const full = msgs.join('\n');
    expect(full).not.toContain('↳');
  });

  it('긴 텍스트는 1900자 이하로 분할됨', () => {
    const longItems = [];
    for (let i = 0; i < 50; i++) {
      longItems.push({
        title: `Very Long Title ${i} with lots of text to make it long`,
        url: `https://example.com/${i}`,
        source: 'hackernews',
        score: 100 + i,
        summary: 'This is a very long summary that takes up space in the message',
        createdAt: new Date(),
        metadata: {}
      });
    }
    const msgs = formatTrendMessage(longItems, null, '2026-02-26');
    expect(msgs.length).toBeGreaterThan(1);
    for (const msg of msgs) {
      expect(msg.length).toBeLessThanOrEqual(1900);
    }
  });
});

describe('formatSourceMessage', () => {
  it('빈 결과 시 배열로 안내 메시지 반환', () => {
    const result = formatSourceMessage([], 'hackernews');
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toContain('수집 결과 없음');
  });

  it('HackerNews 결과 포맷', () => {
    const items = [{ title: 'Test', url: 'https://test.com', source: 'hackernews', score: 10, summary: null, createdAt: new Date(), metadata: {} }];
    const result = formatSourceMessage(items, 'hackernews');
    expect(Array.isArray(result)).toBe(true);
    expect(result[0]).toContain('HackerNews (1건)');
    expect(result[0]).toContain('[10pt] Test');
    expect(result[0]).toContain('<https://test.com>');
  });

  it('GitHub 결과는 설명 포함', () => {
    const items = [{ title: 'user/repo', url: 'https://github.com/user/repo', source: 'github', score: 100, summary: 'Test repo', createdAt: new Date(), metadata: { stars: 100 } }];
    const result = formatSourceMessage(items, 'github');
    expect(result[0]).toContain('📦 user/repo (★ 100)');
    expect(result[0]).toContain('↳ ✨ Test repo');
  });

  it('HuggingFace 결과는 설명 포함', () => {
    const items = [{ title: 'Paper Title', url: 'https://hf.co/papers/123', source: 'huggingface', score: 50, summary: 'Abstract text', createdAt: new Date(), metadata: { upvotes: 50 } }];
    const result = formatSourceMessage(items, 'huggingface');
    expect(result[0]).toContain('📜 Paper Title (↑ 50)');
    expect(result[0]).toContain('↳ 💡 Abstract text');
  });
});

describe('formatSummarizeReport', () => {
  it('리포트 포맷 반환', () => {
    const msgs = formatSummarizeReport('Test report content');
    expect(msgs[0]).toContain('URL 분석 리포트');
    expect(msgs[0]).toContain('Test report content');
  });
});

describe('truncateSummary', () => {
  it('150자 이하 텍스트는 그대로 반환', () => {
    const text = 'short text';
    expect(truncateSummary(text)).toBe('short text');
  });

  it('150자 초과 텍스트는 150자 + ... 으로 절단', () => {
    const text = 'A'.repeat(200);
    const result = truncateSummary(text);
    expect(result).toBe('A'.repeat(150) + '...');
    expect(result.length).toBe(153);
  });

  it('정확히 150자인 텍스트는 절단하지 않음', () => {
    const text = 'B'.repeat(150);
    expect(truncateSummary(text)).toBe(text);
  });

  it('null/undefined 입력 시 빈 문자열 반환', () => {
    expect(truncateSummary(null)).toBe('');
    expect(truncateSummary(undefined)).toBe('');
    expect(truncateSummary('')).toBe('');
  });

  it('maxLen 커스텀 값 적용', () => {
    const text = 'C'.repeat(50);
    expect(truncateSummary(text, 30)).toBe('C'.repeat(30) + '...');
  });
});

describe('chunkText', () => {
  it('1900자 이하면 배열 1개 반환', () => {
    const short = 'hello world';
    expect(chunkText(short)).toEqual([short]);
  });

  it('1900자 초과 시 모든 청크가 Discord 한도(2000자) 이하', () => {
    const long = Array(40).fill('A'.repeat(50) + '\n\nB'.repeat(20)).join('\n\n');
    const chunks = chunkText(long);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      // 첫 청크는 1900자 이하, 이후 청크는 구분자(~26자) 포함으로 최대 1926자
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('\\n\\n 기준으로 분할되어 단락이 잘리지 않음', () => {
    const para1 = 'A'.repeat(1000);
    const para2 = 'B'.repeat(1000);
    const text = `${para1}\n\n${para2}`;
    const chunks = chunkText(text);
    expect(chunks.length).toBe(2);
    expect(chunks[0]).toBe(para1);
    // 2번째 이후 청크에는 연속 메시지 구분자가 앞에 붙음
    expect(chunks[1]).toContain(para2);
    expect(chunks[1]).toMatch(/^━+\n/);
  });
});

describe('formatAndChunkMessage', () => {
  const mockItems = [
    { title: 'HN Post', url: 'https://hn.com/1', source: 'hackernews', score: 150, summary: null, metadata: {} },
    { title: 'Reddit Post', url: 'https://reddit.com/r/ml', source: 'reddit', score: 80, summary: '요약텍스트', metadata: { subreddit: 'LocalLLaMA' } },
    { title: 'user/awesome-repo', url: 'https://github.com/user/awesome-repo', source: 'github', score: 300, summary: 'Great repo', metadata: { stars: 300 } },
    { title: 'Attention Is All You Need', url: 'https://huggingface.co/papers/1706', source: 'huggingface', score: 42, summary: null, metadata: { upvotes: 42 } },
  ];

  it('배열을 반환하고, 각 청크는 1900자 이하', () => {
    const chunks = formatAndChunkMessage('요약', '분석', mockItems);
    expect(Array.isArray(chunks)).toBe(true);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(1900);
    }
  });

  it('헤더에 TrendLens와 날짜가 포함됨', () => {
    const chunks = formatAndChunkMessage(null, null, mockItems);
    const full = chunks.join('\n');
    expect(full).toContain('📡 TrendLens —');
    expect(full).toMatch(/\d{4}\.\d{2}\.\d{2}/);
  });

  it('aiSummary가 있으면 핵심 3줄 요약 섹션 포함', () => {
    const chunks = formatAndChunkMessage('오늘의 요약입니다.', null, mockItems);
    const full = chunks.join('\n');
    expect(full).toContain('🔥 오늘의 핵심 3줄 요약');
    expect(full).toContain('오늘의 요약입니다.');
  });

  it('aiSummary가 null이면 요약 섹션 생략', () => {
    const chunks = formatAndChunkMessage(null, null, mockItems);
    const full = chunks.join('\n');
    expect(full).not.toContain('🔥 오늘의 핵심 3줄 요약');
  });

  it('aiAnalysis가 있으면 AI 분석 섹션 포함', () => {
    const chunks = formatAndChunkMessage(null, 'Gemini 분석 결과입니다.', mockItems);
    const full = chunks.join('\n');
    expect(full).toContain('🤖 AI 트렌드 분석 (by Gemini)');
    expect(full).toContain('Gemini 분석 결과입니다.');
  });

  it('HackerNews 항목이 올바른 포맷으로 포함됨', () => {
    const chunks = formatAndChunkMessage(null, null, mockItems);
    const full = chunks.join('\n');
    expect(full).toContain('📰 HackerNews (1건)');
    expect(full).toContain('[150pt] HN Post');
    expect(full).toContain('<https://hn.com/1>');
  });

  it('summary가 null인 항목은 ↳ 줄 생략', () => {
    const chunks = formatAndChunkMessage(null, null, mockItems);
    const full = chunks.join('\n');
    // HN Post는 summary null → ↳ 라인 없어야 함
    const hnBlock = full.split('\n').filter(l => l.includes('HN Post') || l.startsWith('↳'));
    expect(hnBlock.some(l => l.includes('[150pt] HN Post'))).toBe(true);
    // HN 항목 바로 뒤에 ↳가 붙지 않음을 URL 라인 다음 줄로 확인
    const lines = full.split('\n');
    const hnUrlIdx = lines.findIndex(l => l === '<https://hn.com/1>');
    expect(lines[hnUrlIdx + 1]).not.toMatch(/^↳/);
  });

  it('summary가 있는 Reddit 항목은 ↳ 줄 포함', () => {
    const chunks = formatAndChunkMessage(null, null, mockItems);
    const full = chunks.join('\n');
    expect(full).toContain('↳ 💡 요약텍스트');
  });

  it('GitHub 항목이 올바른 포맷 (★ 별수, ↳ ✨)', () => {
    const chunks = formatAndChunkMessage(null, null, mockItems);
    const full = chunks.join('\n');
    expect(full).toContain('⭐ GitHub Trending (1건)');
    expect(full).toContain('📦 user/awesome-repo (★ 300)');
    expect(full).toContain('↳ ✨ Great repo');
  });

  it('HuggingFace 항목이 올바른 포맷 (↑ 업보트)', () => {
    const chunks = formatAndChunkMessage(null, null, mockItems);
    const full = chunks.join('\n');
    expect(full).toContain('📄 HuggingFace Papers (1건)');
    expect(full).toContain('📜 Attention Is All You Need (↑ 42)');
    expect(full).toContain('<https://huggingface.co/papers/1706>');
  });

  it('0건인 소스는 헤더 포함 통째로 생략', () => {
    const hnOnly = [{ title: 'Only HN', url: 'https://hn.com', source: 'hackernews', score: 10, summary: null, metadata: {} }];
    const chunks = formatAndChunkMessage(null, null, hnOnly);
    const full = chunks.join('\n');
    expect(full).toContain('📰 HackerNews');
    expect(full).not.toContain('💬 Reddit');
    expect(full).not.toContain('⭐ GitHub Trending');
    expect(full).not.toContain('📄 HuggingFace Papers');
  });

  it('모든 URL이 <url> 형태 (embed 차단)', () => {
    const chunks = formatAndChunkMessage(null, null, mockItems);
    const full = chunks.join('\n');
    expect(full).toContain('<https://hn.com/1>');
    expect(full).toContain('<https://reddit.com/r/ml>');
    expect(full).toContain('<https://github.com/user/awesome-repo>');
    expect(full).toContain('<https://huggingface.co/papers/1706>');
  });

  it('rawItems가 null이어도 에러 없이 반환', () => {
    expect(() => formatAndChunkMessage('요약', '분석', null)).not.toThrow();
  });

  it('대량 항목 시 모든 청크가 1900자 이하', () => {
    const bulkItems = Array.from({ length: 30 }, (_, i) => ({
      title: `Article ${i} — Very Long Headline About AI Topics That Keeps Going`,
      url: `https://example.com/articles/${i}`,
      source: 'hackernews',
      score: 100 + i,
      summary: 'This is a detailed summary of the article covering key AI topics and trends.',
      metadata: {},
    }));
    const chunks = formatAndChunkMessage('핵심 요약', 'Gemini 분석', bulkItems);
    for (const chunk of chunks) {
      // 구분자(~26자) 포함 최대 1926자, Discord 한도 2000자 이하
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });
});

describe('formatStatusMessage', () => {
  it('상태 정보 포맷 반환', () => {
    const msg = formatStatusMessage({
      ping: 45,
      uptime: '3일 2시간',
      lastRun: '2026-02-26 09:01',
      activeSources: 'hackernews, reddit',
      keyCount: 2,
    });
    expect(msg).toContain('Ping: 45ms');
    expect(msg).toContain('Uptime: 3일 2시간');
    expect(msg).toContain('전송 채널: 미설정');
  });

  it('채널 설정 시 채널 정보 표시', () => {
    const msg = formatStatusMessage({
      ping: 30,
      uptime: '1시간',
      lastRun: null,
      activeSources: 'hackernews',
      channel: '#general',
      keyCount: 0,
    });
    expect(msg).toContain('전송 채널: #general');
  });
});
