// 예시(가짜) 데이터 만들기 — PLAN 작업 1
// Design Ref: §10.3 — 예시 원본.xlsx / 예시 문항.xlsx / 정답표를 만든다.
// Plan SC: SC-2·3·4·5·8 — 이후 모든 집계 확인의 기준이 되는 정답표.
//
// 실행: node tests/fixtures/make-fixtures.mjs
// 같은 숫자가 항상 다시 나오도록 고정된 규칙(시드)으로 만든다.
// 정답표는 엑셀 파일을 읽어서 만들지 않고, 데이터를 만들 때의 "정답"에서 바로 계산한다.
// 모든 이름·사번·부서·응답은 지어낸 가짜 데이터다.

import ExcelJS from 'exceljs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW_FILE = join(HERE, '예시 원본.xlsx');
const QUESTION_FILE = join(HERE, '예시 문항.xlsx');
const ANSWER_JSON = join(HERE, '정답표.json');
const ANSWER_MD = join(HERE, '정답표.md');

const RESPONDENTS = 40;

// ---------- 고정 규칙으로 섞기 ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261112);

function weightedIndex(weights) {
  const total = weights.reduce((s, w) => s + w, 0);
  let r = rand() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r < 0 && weights[i] > 0) return i;
  }
  return weights.findIndex((w) => w > 0);
}

function shuffle(list) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 문항 정의 ----------
const SCALE5 = ['매우 그렇다', '그렇다', '보통이다', '그렇지 않다', '전혀 그렇지 않다'];

const choiceQuestions = [
  { no: 1, kind: 'single', title: '업무 환경에 전반적으로 만족하십니까?', options: SCALE5, weights: [4, 8, 6, 3, 1], blank: 1 },
  { no: 2, kind: 'single', title: '사내 교육 프로그램이 업무에 도움이 됩니까?', options: SCALE5, weights: [5, 9, 5, 2, 1], blank: 2 },
  { no: 3, kind: 'single', title: '팀 내 소통은 원활합니까?', options: SCALE5, weights: [6, 10, 4, 1, 0], blank: 0 },
  { no: 4, kind: 'single', title: 'KAMP를 얼마나 자주 이용하십니까?', options: ['매일', '주 2~3회', '주 1회', '월 1~2회', '거의 이용하지 않음'], weights: [10, 12, 8, 5, 2], blank: 1 },
  { no: 5, kind: 'single', title: 'KAMP에서 가장 자주 찾는 자료 유형은 무엇입니까?', options: ['업무 매뉴얼', '교육 자료', '사내 공지', '질의응답'], weights: [10, 8, 12, 6], blank: 2, etcTexts: ['회의록', '인사 규정집'] },
  { no: 6, kind: 'single', title: '근무 형태는 무엇입니까?', options: ['사무실 근무', '재택 근무', '혼합 근무'], weights: [16, 6, 14], blank: 0 },
  { no: 7, kind: 'single', title: '신규 기능이 도입된다면 가장 기대되는 점은 무엇입니까?', options: ['검색 정확도 향상', '자료 자동 추천', '협업 기능 강화', '모바일 편의성 개선'], weights: [9, 10, 11, 8], blank: 3 },
  { no: 8, kind: 'single', title: '설문 참여 경험이 있으십니까?', options: ['예', '아니오'], weights: [30, 10], blank: 0 },
  { no: 9, kind: 'multi', title: 'KAMP에서 개선되었으면 하는 점을 모두 선택해 주세요.', options: ['검색 기능', '화면 구성', '알림 기능', '속도', '모바일 지원'], kWeights: [4, 4, 2], blank: 2, etcTexts: ['다국어 지원', '권한 설정', '용량 확대'] },
  { no: 10, kind: 'multi', title: '업무에 활용하는 도구를 모두 선택해 주세요.', options: ['메신저', '화상회의', '문서 공동 편집', '일정 관리', '프로젝트 관리'], kWeights: [3, 4, 3], blank: 1 },
  { no: 11, kind: 'multi', title: '선호하는 교육 방식을 모두 선택해 주세요.', options: ['집합 교육', '온라인 강의', '실습 워크숍', '사례 공유회'], kWeights: [5, 4, 1], blank: 0 },
  { no: 12, kind: 'multi', title: '사내 소통에 주로 쓰는 채널을 모두 선택해 주세요.', options: ['사내 메신저', '이메일', 'KAMP 게시판', '전화', '대면 회의'], kWeights: [3, 5, 2], blank: 1, etcTexts: ['사내 방송', '주간 회의록'] },
  { no: 13, kind: 'single', title: '현재 업무량은 적절합니까?', options: SCALE5, weights: [3, 9, 10, 5, 1], blank: 1 },
  { no: 14, kind: 'single', title: '연령대는 어떻게 되십니까?', options: ['20대', '30대', '40대', '50대 이상'], weights: [5, 14, 14, 7], blank: 0 },
  { no: 15, kind: 'single', title: '근속 연수는 어떻게 되십니까?', options: ['1년 미만', '1~3년', '3~5년', '5~10년', '10년 이상'], weights: [3, 7, 8, 12, 10], blank: 0 },
  { no: 16, kind: 'single', title: 'KAMP를 동료에게 추천하시겠습니까?', options: ['적극 추천', '보통', '추천하지 않음'], weights: [14, 20, 4], blank: 2 },
];

// views = 규칙에 따라 손으로 센 "관점 수" ('.', '그리고', '또한' 뒤에서 나누고,
// ','는 앞뒤가 각각 완결된 문장(끝이 '다'·'요' 등)일 때만 나눈다)
const textQuestions = [
  {
    no: 17,
    title: 'KAMP에서 가장 만족스러운 점을 입력해주세요.',
    blank: 3,
    pool: [
      { text: '검색이 빨라서 자료를 찾기 편하다.', views: 1 },
      { text: '교육 자료가 한곳에 모여 있어서 좋다. 그리고 최신 공지를 바로 확인할 수 있다.', views: 2 },
      { text: '화면이 깔끔하고, 사용법이 쉽다.', views: 1 },
      { text: '질문을 올리면 답변이 빨리 달린다, 동료들의 노하우를 배울 수 있다.', views: 2 },
      { text: '알림 기능이 편리합니다. 또한 모바일에서도 잘 보입니다.', views: 2 },
      { text: '특별히 없습니다.', views: 1 },
      { text: '자료 공유가 쉬워서 협업이 편해졌다.', views: 1 },
      { text: '게시판이 체계적으로 정리되어 있다. 그리고 검색 필터가 다양하다. 또한 첨부파일 미리보기가 좋다.', views: 3 },
      { text: '전반적으로 만족합니다.', views: 1 },
      { text: '빠르고, 정확해서 좋다.', views: 1 },
      { text: '업무 매뉴얼을 쉽게 찾을 수 있고 또한 교육 신청도 간편하다.', views: 2 },
      { text: '속도가 빠르고 그리고 안정적이다.', views: 2 },
    ],
  },
  {
    no: 18,
    title: 'KAMP에서 가장 불편한 점을 작성 부탁드립니다.',
    blank: 5,
    pool: [
      { text: '검색 결과가 너무 많아서 원하는 자료를 찾기 어렵다.', views: 1 },
      { text: '모바일 화면에서 글자가 작다. 그리고 첨부파일이 잘 안 열린다.', views: 2 },
      { text: '로딩이 느리다, 가끔 로그인이 풀린다.', views: 2 },
      { text: '알림이 너무 자주 와서 불편합니다.', views: 1 },
      { text: '메뉴 위치가 자주 바뀌어서 헷갈리고, 도움말이 부족하다.', views: 1 },
      { text: '설문 결과를 엑셀로만 받을 수 있다. 또한 차트가 없어서 직접 만들어야 한다.', views: 2 },
      { text: '특별히 불편한 점은 없습니다.', views: 1 },
      { text: '자료 등록 절차가 복잡하다. 그리고 승인 단계가 너무 많다. 또한 반려 사유가 불명확하다.', views: 3 },
      { text: '댓글 알림이 늦게 온다.', views: 1 },
      { text: '저장이 안 될 때가 있고 그리고 임시저장 기능이 없다.', views: 2 },
    ],
  },
  {
    no: 19,
    title: '추가되었으면 하는 기능이 있다면 입력해주세요.',
    blank: 18,
    pool: [
      { text: '자료 즐겨찾기 기능이 있으면 좋겠습니다.', views: 1 },
      { text: '설문 결과를 자동으로 분석해 주면 좋겠다. 그리고 차트도 만들어 주면 좋겠다.', views: 2 },
      { text: '다크 모드', views: 1 },
      { text: '부서별 자료함이 필요합니다.', views: 1 },
      { text: '음성 검색, 번역 기능이 있으면 좋겠다.', views: 1 },
      { text: '없음', views: 1 },
      { text: '회의록 자동 요약 기능이 필요하다. 또한 일정 연동도 되면 좋겠다.', views: 2 },
      { text: '알림 시간을 설정할 수 있으면 좋겠다.', views: 1 },
    ],
  },
  {
    no: 20,
    title: '그 밖에 하고 싶은 말씀을 작성 부탁드립니다.',
    blank: 22,
    pool: [
      { text: '수고하셨습니다.', views: 1 },
      { text: '설문 결과를 빨리 볼 수 있으면 좋겠습니다. 감사합니다.', views: 2 },
      { text: '현재도 충분히 좋습니다.', views: 1 },
      { text: '교육 일정을 미리 알려 주면 좋겠다, 신청 절차도 간단해지면 좋겠다.', views: 2 },
      { text: 'KAMP 덕분에 업무가 편해졌습니다. 그리고 앞으로도 개선을 부탁드립니다.', views: 2 },
      { text: '없습니다.', views: 1 },
      { text: '응답 시간이 길어서 힘들었다.', views: 1 },
      { text: '의견을 반영해 주셔서 감사합니다. 또한 결과도 공유해 주세요.', views: 2 },
    ],
  },
];

// 엑셀 원본 모양: A~G열 = 참여일·이름·사번·부서·직급·직위·직책(참여자 정보), H열부터 "문항번호1", "문항번호2"…
const INFO_HEADERS = ['참여일', '이름', '사번', '부서', '직급', '직위', '직책'];
const INFO_COLUMN_COUNT = INFO_HEADERS.length;
// 원본에는 있지만 문항 파일에는 없는 문항 열 ("문항번호21")
const EXTRA_COLUMN_NO = 21;
const RAW_COLUMN_COUNT = INFO_COLUMN_COUNT + EXTRA_COLUMN_NO;
const questionColumn = (no) => INFO_COLUMN_COUNT + no; // 엑셀 열 번호(1부터): 문항번호n은 H열(8번째)부터

const NAMES = [
  '김하늘', '이서준', '박지우', '최민서', '정도윤', '강서연', '조현우', '윤지아', '장예준', '임수아',
  '한지민', '오세훈', '서유진', '신동혁', '권나윤', '황민재', '안소희', '송태양', '류가은', '홍길상',
  '전보라', '고은채', '문시우', '양하린', '손지호', '배서윤', '백도현', '허연우', '남궁민수', '황보라온',
  '유하준', '노채원', '하은솔', '심재이', '천유나', '방지후', '마동건', '석다온', '표지안', '이솔',
];
const DEPARTMENTS = ['기획처', '경영지원실', '디지털혁신본부', '영업부', '연구원', '인재개발원', '품질관리부', '재무실'];
const RANKS = ['사원', '대리', '과장', '차장', '부장'];
const POSITIONS = ['선임', '책임', '수석', '연구원', '주임'];
const DUTIES = ['팀원', '팀원', '팀원', '파트장', '팀장'];

// ---------- 응답 만들기 (정답 기준: 논리 값) ----------
// 칸 값: { t: 'blank', space } | { t: 'pick', picks: [번호...] } | { t: 'etc', text } | { t: 'text', text, views }
const cells = {}; // cells[문항번호][응답자 0..39]

function buildChoice(q) {
  const order = shuffle([...Array(RESPONDENTS).keys()]);
  const blankSet = new Set(order.slice(0, q.blank));
  const etcList = q.etcTexts ?? [];
  const etcAt = new Map(order.slice(q.blank, q.blank + etcList.length).map((r, i) => [r, etcList[i]]));
  const column = [];
  let blankSeen = 0;
  for (let r = 0; r < RESPONDENTS; r++) {
    if (blankSet.has(r)) {
      column.push({ t: 'blank', space: blankSeen++ % 2 === 1 }); // 일부 빈 칸은 공백 한 칸
    } else if (etcAt.has(r)) {
      column.push({ t: 'etc', text: etcAt.get(r) });
    } else if (q.kind === 'single') {
      column.push({ t: 'pick', picks: [weightedIndex(q.weights) + 1] });
    } else {
      const k = Math.min(weightedIndex(q.kWeights) + 1, q.options.length);
      const picks = shuffle(q.options.map((_, i) => i + 1)).slice(0, k).sort((a, b) => a - b);
      column.push({ t: 'pick', picks });
    }
  }
  cells[q.no] = column;
}

function buildText(q) {
  const order = shuffle([...Array(RESPONDENTS).keys()]);
  const blankSet = new Set(order.slice(0, q.blank));
  const column = [];
  let blankSeen = 0;
  for (let r = 0; r < RESPONDENTS; r++) {
    if (blankSet.has(r)) {
      column.push({ t: 'blank', space: blankSeen++ % 2 === 1 });
    } else {
      const item = q.pool[Math.floor(rand() * q.pool.length)];
      column.push({ t: 'text', text: item.text, views: item.views });
    }
  }
  cells[q.no] = column;
}

choiceQuestions.forEach(buildChoice);
textQuestions.forEach(buildText);

// 참여자 정보 (A~G열). 직급은 일부러 빈 칸 2명(공백 한 칸 1명 포함)을 두어 "(미기재)" 집단을 확인할 수 있게 한다
const NO_GROUP = '(미기재)';
const participants = {
  date: NAMES.map((_, i) => `2026-11-${String(1 + (i % 9)).padStart(2, '0')}`),
  name: NAMES,
  id: NAMES.map((_, i) => (i < 36 ? 10001 + i * 251 : 123400 + i)), // 5자리 36명, 6자리 4명
  department: NAMES.map((_, i) => DEPARTMENTS[(i * 3 + Math.floor(i / 5)) % DEPARTMENTS.length]),
  rank: NAMES.map((_, i) => (i === 6 ? null : i === 21 ? ' ' : RANKS[(i * 2 + Math.floor(i / 7)) % RANKS.length])),
  position: NAMES.map((_, i) => POSITIONS[(i + Math.floor(i / 3)) % POSITIONS.length]),
  duty: NAMES.map((_, i) => DUTIES[(i * 2) % DUTIES.length]),
};
const extraValues = NAMES.map((_, i) => `2026-11-${String(1 + (i % 9)).padStart(2, '0')} ${9 + (i % 8)}:${String((i * 7) % 60).padStart(2, '0')}`);

// ---------- 정답표 계산 ----------
// 비율: 소수 첫째 자리로 반올림 → 합이 100.0이 아니면 가장 큰 항목에서 보정 (DESIGN 3.1)
function percentRows(rows) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  if (total === 0) return rows.map((r) => ({ ...r, percent: 0 }));
  // 정수 계산으로 정확한 반올림(0.5는 올림)
  const tenths = rows.map((r) => Math.floor((2 * r.count * 1000 + total) / (2 * total)));
  const diff = 1000 - tenths.reduce((s, t) => s + t, 0);
  if (diff !== 0) {
    let target = 0;
    rows.forEach((r, i) => {
      if (r.count > rows[target].count) target = i; // 동률이면 앞(번호가 작은 쪽)을 유지
    });
    tenths[target] += diff;
  }
  return rows.map((r, i) => ({ ...r, percent: tenths[i] / 10 }));
}

// 집단별(부서·직급) 정답: 응답자를 집단으로 나눠 같은 규칙으로 다시 센다. 집단은 응답자가 많은 순(같으면 이름 순), (미기재)는 맨 뒤.
// 모든 집단 표는 문항 전체의 보기 줄(기타 포함)을 그대로 쓰고, 그 집단에 없는 보기는 0건·0.0%다.
function groupResultsFor(q, wholeRows) {
  const out = {};
  for (const role of ['department', 'rank']) {
    const byGroup = new Map();
    for (let r = 0; r < RESPONDENTS; r++) {
      const raw = participants[role][r];
      const name = raw === null || String(raw).trim() === '' ? NO_GROUP : String(raw).trim();
      if (!byGroup.has(name)) byGroup.set(name, []);
      byGroup.get(name).push(r);
    }
    const groups = [...byGroup.entries()].map(([name, members]) => {
      const counts = new Map(wholeRows.map((row) => [row.optionNo, 0]));
      let noAnswer = 0;
      let multi = 0;
      for (const r of members) {
        const c = cells[q.no][r];
        if (c.t === 'blank') noAnswer++;
        else if (c.t === 'etc') counts.set('etc', (counts.get('etc') ?? 0) + 1);
        else {
          c.picks.forEach((n) => counts.set(n, counts.get(n) + 1));
          if (c.picks.length >= 2) multi++;
        }
      }
      const rows = percentRows(wholeRows.map((row) => ({ optionNo: row.optionNo, label: row.label, count: counts.get(row.optionNo) })));
      return { name, respondents: members.length, noAnswer, multiAnswerCount: multi, totalSelections: rows.reduce((s, x) => s + x.count, 0), rows };
    });
    groups.sort((a, b) => {
      if (a.name === NO_GROUP || b.name === NO_GROUP) return a.name === NO_GROUP ? 1 : -1;
      return b.respondents - a.respondents || a.name.localeCompare(b.name, 'ko');
    });
    out[role] = groups;
  }
  return out;
}

const expectedQuestions = [];

for (const q of choiceQuestions) {
  const column = cells[q.no];
  const counts = q.options.map(() => 0);
  let etc = 0;
  let noAnswer = 0;
  let multiAnswerCount = 0;
  for (const c of column) {
    if (c.t === 'blank') noAnswer++;
    else if (c.t === 'etc') etc++;
    else {
      c.picks.forEach((n) => counts[n - 1]++);
      if (c.picks.length >= 2) multiAnswerCount++;
    }
  }
  const rows = q.options.map((label, i) => ({ optionNo: i + 1, label: `${i + 1}. ${label}`, count: counts[i] }));
  if (etc > 0) rows.push({ optionNo: 'etc', label: '기타', count: etc });
  const withPercent = percentRows(rows);
  const totalSelections = withPercent.reduce((s, r) => s + r.count, 0);
  const answered = RESPONDENTS - noAnswer;
  const numericRatio = Math.round(((answered - etc) / answered) * 1000) / 1000;
  if (numericRatio < 0.9) throw new Error(`문항 ${q.no}: 보기 번호 응답 비율이 90% 미만입니다 (${numericRatio})`);
  const percentSum = Math.round(withPercent.reduce((s, r) => s + r.percent, 0) * 10) / 10;
  if (percentSum !== 100) throw new Error(`문항 ${q.no}: 비율 합계가 100.0이 아닙니다 (${percentSum})`);
  expectedQuestions.push({
    no: q.no,
    type: 'choice',
    multi: q.kind === 'multi',
    title: q.title,
    respondents: RESPONDENTS,
    noAnswer,
    answered,
    totalSelections,
    multiAnswerCount,
    etcCount: etc,
    numericAnswerRatio: numericRatio,
    rows: withPercent,
    percentSum,
    groupResults: groupResultsFor(q, withPercent),
  });
}

for (const q of textQuestions) {
  const column = cells[q.no];
  const answers = [];
  column.forEach((c, r) => {
    if (c.t === 'text') answers.push({ respondent: r + 1, text: c.text, viewCount: c.views });
  });
  expectedQuestions.push({
    no: q.no,
    type: 'text',
    title: q.title,
    respondents: RESPONDENTS,
    noAnswer: RESPONDENTS - answers.length,
    answerCount: answers.length,
    totalViews: answers.reduce((s, a) => s + a.viewCount, 0),
    answers,
  });
}

expectedQuestions.sort((a, b) => a.no - b.no);

const expected = {
  meta: {
    note: '모든 값은 가짜(예시) 데이터입니다. 정답표는 만들 때의 정답에서 직접 계산했습니다.',
    respondents: RESPONDENTS,
    surveyQuestionCount: 20,
    questionFileEntryCount: 20,
    rawColumnCount: RAW_COLUMN_COUNT,
    rules: [
      '비율 = 선택지별 선택 건수 ÷ 전체 선택 건수 (무응답 제외, 기타 포함)',
      '소수 첫째 자리로 반올림한 뒤 합계가 100.0이 아니면 비율이 가장 큰 항목에서 차이를 더하거나 뺀다 (동률이면 번호가 작은 쪽)',
      '쉼표로 이어진 숫자(1,3)는 하나하나 선택 1건으로 센다',
      '숫자가 아닌 글은 기타 1건으로 센다 (기타 줄은 직접 입력이 있을 때만 나온다)',
      '빈 칸과 공백만 있는 칸은 무응답이다',
      '중복응답 건수 = 2개 이상 고른 응답자 수',
    ],
  },
  questions: expectedQuestions,
  // 문항 유형을 추정한 결과로 기대하는 값 (질문 끝 문구 → 90% 규칙)
  expectedTypes: Object.fromEntries([
    ...choiceQuestions.map((q) => [q.no, 'choice']),
    ...textQuestions.map((q) => [q.no, 'text']),
  ]),
  // 분석에서 빠져야 하는 열
  // (A~G열 참여자 정보는 "분석에서 뺀 열" 목록이 아니라 participants의 선택 대상이다)
  excludedColumns: [{ no: EXTRA_COLUMN_NO, reason: 'not-in-questions' }],
  // 참여자 정보 열(B~G): 사용자가 "반영"을 고르면 열마다 주관식·서술형 문항 카드가 된다 (AI에는 보내지 않는다)
  participantColumns: ['name', 'id', 'department', 'rank', 'position', 'duty'].map((role, i) => ({
    role,
    header: INFO_HEADERS[i + 1],
    answerCount: participants[role].filter((v) => v !== null && String(v).trim() !== '').length,
    answers: participants[role].map((v) => (v === null || String(v).trim() === '' ? null : String(v).trim())),
  })),
  // 관점 나누기: 규칙을 손으로 적용해 센 관점 수 (답변 목록은 questions[].answers)
  viewCountExamples: [
    { text: '빠르고, 정확해서 좋다.', viewCount: 1, why: '쉼표 앞이 완결된 문장이 아니다' },
    { text: '질문을 올리면 답변이 빨리 달린다, 동료들의 노하우를 배울 수 있다.', viewCount: 2, why: '쉼표 앞뒤가 모두 완결된 문장이다' },
    { text: '교육 자료가 한곳에 모여 있어서 좋다. 그리고 최신 공지를 바로 확인할 수 있다.', viewCount: 2, why: "'.'에서 나눈다" },
    { text: '속도가 빠르고 그리고 안정적이다.', viewCount: 2, why: "'그리고' 뒤에서 나눈다" },
    { text: '게시판이 체계적으로 정리되어 있다. 그리고 검색 필터가 다양하다. 또한 첨부파일 미리보기가 좋다.', viewCount: 3, why: "'.'와 '또한'" },
  ],
};

// ---------- 엑셀 파일 쓰기 ----------
function cellToExcel(c) {
  if (c.t === 'blank') return c.space ? ' ' : null;
  if (c.t === 'pick') return c.picks.length === 1 ? c.picks[0] : c.picks.join(',');
  return c.text; // etc / text
}

async function writeRaw() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('응답');
  const header = [...INFO_HEADERS];
  for (let n = 1; n <= EXTRA_COLUMN_NO; n++) header.push(`문항번호${n}`);
  ws.addRow(header);
  for (let r = 0; r < RESPONDENTS; r++) {
    const row = [participants.date[r], participants.name[r], participants.id[r], participants.department[r], participants.rank[r], participants.position[r], participants.duty[r]];
    for (let n = 1; n <= 20; n++) row.push(cellToExcel(cells[n][r]));
    row.push(extraValues[r]);
    ws.addRow(row);
  }
  await wb.xlsx.writeFile(RAW_FILE);
}

async function writeQuestions() {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('문항');
  const all = [
    ...choiceQuestions.map((q) => ({ no: q.no, title: q.title, options: q.options })),
    ...textQuestions.map((q) => ({ no: q.no, title: q.title, options: [] })),
  ].sort((a, b) => a.no - b.no);
  for (const q of all) {
    ws.addRow([q.no, q.title]); // 문항 줄: A=문항 번호, B=질문
    q.options.forEach((label, i) => ws.addRow([null, `${i + 1}. ${label}`])); // 보기 줄: B="번호. 보기 내용"
  }
  ws.getColumn(2).width = 60;
  await wb.xlsx.writeFile(QUESTION_FILE);
}

// ---------- 정답표 파일 쓰기 ----------
function writeAnswerFiles() {
  writeFileSync(ANSWER_JSON, JSON.stringify(expected, null, 2) + '\n', 'utf8');

  const md = [];
  md.push('# 예시 데이터 정답표');
  md.push('');
  md.push('> 모든 이름·사번·부서·응답은 **지어낸 가짜 데이터**입니다. `node tests/fixtures/make-fixtures.mjs`로 다시 만들 수 있고, 항상 같은 값이 나옵니다.');
  md.push('');
  md.push('## 파일 모양 (가정)');
  md.push('');
  md.push('- **예시 원본.xlsx** — 1행은 열 제목, 2~41행은 응답자 40명(한 명당 한 줄).');
  md.push('  - A~G열: 참여일, 이름, 사번, 부서, 직급, 직위, 직책 (A열은 쓰지 않고, B~G열은 참여자 정보로 따로 읽음)');
  md.push('  - H열부터: 열 제목이 `문항번호1`, `문항번호2`… `문항번호20` (설문 문항 응답. 객관식은 보기 번호, 중복응답은 `1,3`, 직접 입력은 글, 주관식·서술형은 글)');
  md.push('  - 마지막 열 `문항번호21` (제출 일시): 문항 파일에 없는 번호의 열 (분석에서 빠져야 함)');
  md.push('- **예시 문항.xlsx** — 문항 줄은 A열에 문항 번호, B열에 질문. 그 아래 보기 줄은 A열이 비어 있고 B열에 `3. 보통이다` 모양으로 적혀 있음. 문항 파일에는 문항 20개가 있음.');
  md.push('- 이 모양은 설계 가정입니다. 실제 설문 시스템의 문항 파일 모양이 다르면 알려 주세요.');
  md.push('');
  md.push('## 세는 기준');
  md.push('');
  expected.meta.rules.forEach((r) => md.push(`- ${r}`));
  md.push('');
  md.push('## 분석에서 빠져야 하는 열');
  md.push('');
  md.push('| 열 | 이유 |');
  md.push('|---|---|');
  const reasonLabel = { 'not-in-questions': '문항 파일에 없는 번호' };
  expected.excludedColumns.forEach((c) => md.push(`| ${c.no} | ${reasonLabel[c.reason]} |`));
  md.push('');
  md.push('## 참여자 정보 열 (B~G열)');
  md.push('');
  md.push('사용자가 "참여자 정보를 반영한다"를 고르면 열마다 주관식·서술형 문항 카드가 되고(AI에는 보내지 않음), 고르지 않으면 결과에 넣지 않는다.');
  md.push('');
  md.push('| 열 | 종류 | 응답 수 |');
  md.push('|---|---|--:|');
  expected.participantColumns.forEach((c) => md.push(`| ${c.header} | ${c.role} | ${c.answerCount} |`));
  md.push('');
  md.push('직급은 빈 칸 2명(공백 한 칸 1명 포함)이 있어 집단별로 나누면 `(미기재)` 집단이 생긴다. 집단별 정답은 정답표.json의 `groupResults`에 있다.');
  md.push('');
  md.push('## 객관식 문항별 정답');
  md.push('');
  for (const q of expectedQuestions.filter((x) => x.type === 'choice')) {
    md.push(`### ${q.no}. ${q.title}${q.multi ? ' (중복응답)' : ''}`);
    md.push('');
    md.push(`응답자 ${q.respondents}명 · 무응답 ${q.noAnswer}명 · 전체 선택 ${q.totalSelections}건 · 중복응답 ${q.multiAnswerCount}건`);
    md.push('');
    md.push('| 보기 | 응답 수 | 비율 |');
    md.push('|---|--:|--:|');
    q.rows.forEach((r) => md.push(`| ${r.label} | ${r.count} | ${r.percent.toFixed(1)}% |`));
    md.push(`| **합계** | ${q.totalSelections} | ${q.percentSum.toFixed(1)}% |`);
    md.push('');
  }
  md.push('## 주관식·서술형 문항별 정답');
  md.push('');
  md.push('| 문항 | 응답자 | 무응답 | 응답 수 | 나눈 관점 합계 |');
  md.push('|---|--:|--:|--:|--:|');
  for (const q of expectedQuestions.filter((x) => x.type === 'text')) {
    md.push(`| ${q.no}. ${q.title} | ${q.respondents} | ${q.noAnswer} | ${q.answerCount} | ${q.totalViews} |`);
  }
  md.push('');
  md.push('### 관점 나누기 예시 (손으로 센 값)');
  md.push('');
  md.push('| 답변 | 관점 수 | 이유 |');
  md.push('|---|--:|---|');
  expected.viewCountExamples.forEach((e) => md.push(`| ${e.text} | ${e.viewCount} | ${e.why} |`));
  md.push('');
  writeFileSync(ANSWER_MD, md.join('\n'), 'utf8');
}

// ---------- 만든 엑셀 파일이 정답표와 같은지 다시 읽어서 확인 ----------
const NUM_RE = /^\d+(,\d+)*$/;
const isBlank = (v) => v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

async function verify() {
  const problems = [];
  const raw = new ExcelJS.Workbook();
  await raw.xlsx.readFile(RAW_FILE);
  const ws = raw.worksheets[0];
  if (ws.rowCount !== RESPONDENTS + 1) problems.push(`원본 행 수가 ${ws.rowCount}입니다`);
  if (ws.columnCount !== RAW_COLUMN_COUNT) problems.push(`원본 열 수가 ${ws.columnCount}입니다`);
  INFO_HEADERS.forEach((h, i) => {
    if (ws.getRow(1).getCell(i + 1).value !== h) problems.push(`${i + 1}번째 열 제목이 ${h}가 아닙니다`);
  });
  for (let n = 1; n <= EXTRA_COLUMN_NO; n++) {
    if (ws.getRow(1).getCell(questionColumn(n)).value !== `문항번호${n}`) problems.push(`${questionColumn(n)}번째 열 제목이 문항번호${n}이 아닙니다`);
  }

  for (const q of expectedQuestions) {
    const col = [];
    for (let r = 2; r <= RESPONDENTS + 1; r++) col.push(ws.getRow(r).getCell(questionColumn(q.no)).value);
    const blanks = col.filter(isBlank).length;
    if (blanks !== q.noAnswer) problems.push(`문항 ${q.no}: 무응답 ${blanks} ≠ 정답표 ${q.noAnswer}`);
    if (q.type === 'text') {
      if (RESPONDENTS - blanks !== q.answerCount) problems.push(`문항 ${q.no}: 응답 수 불일치`);
      continue;
    }
    const counts = new Map();
    let etc = 0;
    let multi = 0;
    for (const v of col) {
      if (isBlank(v)) continue;
      const s = typeof v === 'number' ? String(v) : String(v);
      if (NUM_RE.test(s)) {
        const picks = s.split(',').map(Number);
        picks.forEach((n) => counts.set(n, (counts.get(n) ?? 0) + 1));
        if (picks.length >= 2) multi++;
      } else etc++;
    }
    for (const row of q.rows) {
      const got = row.optionNo === 'etc' ? etc : counts.get(row.optionNo) ?? 0;
      if (got !== row.count) problems.push(`문항 ${q.no} ${row.label}: 파일 ${got} ≠ 정답표 ${row.count}`);
    }
    if (multi !== q.multiAnswerCount) problems.push(`문항 ${q.no}: 중복응답 건수 불일치`);
    if (!q.multi && multi > 0) problems.push(`문항 ${q.no}: 단일선택인데 중복응답이 있습니다`);
  }

  for (let r = 2; r <= RESPONDENTS + 1; r++) {
    const name = ws.getRow(r).getCell(2).value;
    const id = String(ws.getRow(r).getCell(3).value);
    const dept = ws.getRow(r).getCell(4).value;
    if (!/^[가-힣]{2,5}$/.test(name)) problems.push(`이름 형식 위반: ${name}`);
    if (!/^\d{5,6}$/.test(id)) problems.push(`사번 형식 위반: ${id}`);
    if (!/(처|본부|실|부|원)$/.test(dept)) problems.push(`부서 형식 위반: ${dept}`);
  }

  // 이름 규칙이 다른 주관식 열(17~20)을 이름 열로 잘못 잡지 않는지: 한글 2~5글자만으로 된 열이 없어야 한다
  for (const q of textQuestions) {
    const answers = [];
    for (let r = 2; r <= RESPONDENTS + 1; r++) {
      const v = ws.getRow(r).getCell(questionColumn(q.no)).value;
      if (!isBlank(v)) answers.push(String(v));
    }
    if (answers.every((a) => /^[가-힣]{2,5}$/.test(a))) problems.push(`문항 ${q.no}: 모든 응답이 이름처럼 보입니다`);
    if (answers.every((a) => /^\d{5,6}$/.test(a))) problems.push(`문항 ${q.no}: 모든 응답이 사번처럼 보입니다`);
  }

  const qf = new ExcelJS.Workbook();
  await qf.xlsx.readFile(QUESTION_FILE);
  const qs = qf.worksheets[0];
  let questionRows = 0;
  const optionCounts = {};
  let current = null;
  qs.eachRow((row) => {
    const a = row.getCell(1).value;
    const b = row.getCell(2).value;
    if (typeof a === 'number') {
      questionRows++;
      current = a;
      optionCounts[current] = 0;
    } else if (typeof b === 'string' && /^\d+\. /.test(b)) {
      optionCounts[current]++;
    }
  });
  if (questionRows !== 20) problems.push(`문항 파일의 문항 수가 ${questionRows}입니다`);
  for (const q of choiceQuestions) {
    if (optionCounts[q.no] !== q.options.length) problems.push(`문항 ${q.no}: 보기 수 불일치`);
  }
  return problems;
}

mkdirSync(HERE, { recursive: true });
await writeRaw();
await writeQuestions();
writeAnswerFiles();
const problems = await verify();
if (problems.length > 0) {
  console.error('확인 실패:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log('예시 데이터를 만들었고, 엑셀 파일과 정답표가 서로 일치합니다.');
console.log(`- 응답자 ${RESPONDENTS}명, 설문 문항 20개 (객관식 16, 주관식·서술형 4) + 참여자 정보 열 A~G + 문항 파일에 없는 열 1개(문항번호21)`);
