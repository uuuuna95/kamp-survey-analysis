// Design Ref: §10.1 / §6 — 작업 20: 결과 엑셀 만들기. 만든 파일을 다시 읽어서 시트 3개, 화면과 같은 숫자, 개인정보 열 없음, 차트 그림을 확인한다.
// 실행: npm test  (차트 그림은 브라우저에서만 만들 수 있어서, 여기서는 가짜 그림으로 "넣는 자리와 개수"를 확인한다)

import { readFileSync } from 'node:fs';
import ExcelJS from 'exceljs';
import { describe, expect, it, vi } from 'vitest';
import { CHART_IMAGE_WIDTH, SHEET_CHOICE, SHEET_SUMMARY, SHEET_TEXT, buildWorkbook, percentSum } from '../src/lib/excel/build-workbook';
import type { BuildOptions } from '../src/lib/excel/build-workbook';
import { analyzeSurvey } from '../src/lib/survey/analyze';
import type { Analysis } from '../src/lib/survey/analyze';
import { chartHeight } from '../src/lib/survey/chart-config';
import { loadSurvey } from '../src/lib/survey/load';

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
const loaded = await loadSurvey(fixture('예시 원본.xlsx'), fixture('예시 문항.xlsx'));
if (!loaded.ok) throw new Error('예시 파일을 읽지 못했어요');
const survey = loaded.survey;
const base = analyzeSurvey(survey);

// 1x1 PNG (가짜 차트 그림)
const FAKE_PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));

async function build(analysis: Analysis, options: BuildOptions = {}): Promise<ExcelJS.Workbook> {
  const bytes = await buildWorkbook(analysis, options);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  return workbook;
}

/** 셀 값을 글/숫자로 */
const val = (ws: ExcelJS.Worksheet, r: number, c: number) => {
  const v = ws.getCell(r, c).value;
  return v === null || v === undefined ? null : typeof v === 'object' && 'richText' in v ? v.richText.map((t) => t.text).join('') : (v as string | number);
};

/** 시트에서 첫 칸이 정확히 text인 줄 번호 */
const findRow = (ws: ExcelJS.Worksheet, text: string): number => {
  for (let r = 1; r <= ws.rowCount; r++) if (val(ws, r, 1) === text) return r;
  return -1;
};

const allText = (wb: ExcelJS.Workbook): string => {
  const parts: string[] = [];
  wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((cell) => parts.push(String(cell.value ?? '')))));
  return parts.join('\n');
};

describe('작업 20 · 시트 구성', () => {
  it('시트는 정확히 3개: 문항별 요약 / 객관식 결과 / 주관식·서술형 결과', async () => {
    const wb = await build(base);
    expect(wb.worksheets.map((w) => w.name)).toEqual([SHEET_SUMMARY, SHEET_CHOICE, SHEET_TEXT]);
    expect([SHEET_SUMMARY, SHEET_CHOICE, SHEET_TEXT]).toEqual(['문항별 요약', '객관식 결과', '주관식·서술형 결과']);
  });

  it('문항이 한쪽 유형뿐이어도 시트 3개는 그대로 있고 안내 글이 들어간다', async () => {
    const onlyText = { ...base, questions: base.questions.filter((q) => q.outcome.type === 'text') };
    const wb = await build(onlyText);
    expect(wb.worksheets).toHaveLength(3);
    expect(val(wb.getWorksheet(SHEET_CHOICE)!, 1, 1)).toBe('객관식 문항이 없어요.');
    const onlyChoice = { ...base, questions: base.questions.filter((q) => q.outcome.type === 'choice') };
    expect(val((await build(onlyChoice)).getWorksheet(SHEET_TEXT)!, 2, 1)).toBe('주관식·서술형 문항이 없어요.');
  });
});

describe('작업 20 · 시트 1: 문항별 요약 — 화면과 같은 숫자', () => {
  it('문항마다 한 줄: 번호·질문·유형·응답자 수·응답 건수·중복응답 건수·무응답 수', async () => {
    const ws = (await build(base)).getWorksheet(SHEET_SUMMARY)!;
    expect([1, 2, 3, 4, 5, 6, 7].map((c) => val(ws, 1, c))).toEqual(['문항', '질문', '유형', '응답자 수', '응답 건수', '중복응답 건수', '무응답 수']);
    base.questions.forEach((item, i) => {
      const r = i + 2;
      const o = item.outcome;
      expect(val(ws, r, 1)).toBe(item.question.no);
      expect(val(ws, r, 2)).toBe(item.question.title);
      expect(val(ws, r, 3)).toBe(o.type === 'choice' ? '객관식' : '주관식·서술형');
      expect(val(ws, r, 4)).toBe(o.result.respondents);
      expect(val(ws, r, 5)).toBe(o.type === 'choice' ? o.result.totalSelections : o.result.answers.length);
      expect(val(ws, r, 6)).toBe(o.type === 'choice' ? o.result.multiAnswerCount : null);
      expect(val(ws, r, 7)).toBe(o.result.noAnswer);
    });
  });

  it('응답자 수·문항 수와, 뺀 열이 있으면 "넣지 않았어요" 안내가 있다', async () => {
    const text = allText(await build(base));
    expect(text).toContain(`응답자 ${base.respondents}명 · 문항 ${base.questions.length}개`);
    expect(text).toContain(`분석에서 뺀 열 ${base.restorable.length}개는 파일에 넣지 않았어요.`);
  });
});

describe('작업 20 · 시트 2: 객관식 결과 — 화면 표와 같은 숫자', () => {
  it('문항마다 제목·요약 줄·보기별 응답 수와 비율·합계가 화면과 같다', async () => {
    const ws = (await build(base)).getWorksheet(SHEET_CHOICE)!;
    for (const item of base.questions) {
      if (item.outcome.type !== 'choice') continue;
      const result = item.outcome.result;
      const top = findRow(ws, `Q${item.question.no}. ${item.question.title}`);
      expect(top, `Q${item.question.no} 제목 줄`).toBeGreaterThan(0);
      expect(val(ws, top + 1, 1)).toBe(
        `응답자 ${result.respondents}명 · 응답 ${result.totalSelections}건 · 중복응답 ${result.multiAnswerCount}건 · 무응답 ${result.noAnswer}명`,
      );
      if (result.totalSelections === 0) continue;
      expect([1, 2, 3].map((c) => val(ws, top + 2, c))).toEqual(['보기', '응답 수', '비율(%)']);
      result.rows.forEach((row, i) => {
        const r = top + 3 + i;
        expect([val(ws, r, 1), val(ws, r, 2), val(ws, r, 3)]).toEqual([row.label, row.count, row.percent]);
      });
      const totalRow = top + 3 + result.rows.length;
      expect([val(ws, totalRow, 1), val(ws, totalRow, 2), val(ws, totalRow, 3)]).toEqual(['합계', result.totalSelections, percentSum(result)]);
      expect(percentSum(result)).toBe(100);
    }
  });

  it('중복응답·기타·무응답이 있는 문항도 응답 수 합계가 합계 줄과 같다', async () => {
    const ws = (await build(base)).getWorksheet(SHEET_CHOICE)!;
    for (const item of base.questions) {
      if (item.outcome.type !== 'choice' || item.outcome.result.totalSelections === 0) continue;
      const top = findRow(ws, `Q${item.question.no}. ${item.question.title}`);
      const n = item.outcome.result.rows.length;
      let sum = 0;
      for (let i = 0; i < n; i++) sum += val(ws, top + 3 + i, 2) as number;
      expect(sum).toBe(val(ws, top + 3 + n, 2));
    }
  });
});

describe('작업 20 · 시트 3: 주관식·서술형 결과', () => {
  it('문항마다 응답 목록(원문)이 순서대로 들어가고 개수가 요약과 같다', async () => {
    const ws = (await build(base)).getWorksheet(SHEET_TEXT)!;
    expect(val(ws, 1, 1)).toContain('개인정보');
    for (const item of base.questions) {
      if (item.outcome.type !== 'text') continue;
      const { answers } = item.outcome.result;
      const top = findRow(ws, `Q${item.question.no}. ${item.question.title}`);
      expect(top).toBeGreaterThan(0);
      const header = (() => {
        for (let r = top; r < ws.rowCount; r++) if (val(ws, r, 1) === '번호') return r;
        return -1;
      })();
      expect(val(ws, header, 2)).toBe(`응답 목록 (${answers.length}건)`);
      answers.forEach((answer, i) => {
        expect([val(ws, header + 1 + i, 1), val(ws, header + 1 + i, 2)]).toEqual([i + 1, answer]);
      });
    }
  });
});

describe('작업 20 · AI 해석', () => {
  const textNo = base.questions.find((q) => q.outcome.type === 'text')!.question.no;
  const choiceNo = base.questions.find((q) => q.outcome.type === 'choice')!.question.no;

  it('해석을 주면 객관식은 해석 줄, 주관식·서술형은 의견과 건수가 들어간다', async () => {
    const wb = await build(base, {
      interpretations: {
        [choiceNo]: { text: '가장 많은 선택은 보통이다(47.3%)예요. 다음은 적어요.' },
        [textNo]: { opinions: [{ summary: '화면이 어려워요', viewIds: [1], count: 7 }, { summary: '검색이 느려요', viewIds: [2], count: 3 }] },
      },
    });
    expect(allText(wb)).toContain('AI 해석: 가장 많은 선택은 보통이다(47.3%)예요. 다음은 적어요.');
    const ws = wb.getWorksheet(SHEET_TEXT)!;
    const top = findRow(ws, `Q${textNo}. ${base.questions.find((q) => q.question.no === textNo)!.question.title}`);
    expect([val(ws, top + 2, 1), val(ws, top + 2, 2), val(ws, top + 2, 3)]).toEqual(['주요 의견', '요약 (AI 정리)', '응답자 수']);
    expect([val(ws, top + 3, 1), val(ws, top + 3, 2), val(ws, top + 3, 3)]).toEqual(['의견 1', '화면이 어려워요', 7]);
    expect([val(ws, top + 4, 2), val(ws, top + 4, 3)]).toEqual(['검색이 느려요', 3]);
  });

  it('해석을 만들지 않았으면 해석 줄이 없다', async () => {
    const text = allText(await build(base));
    expect(text).not.toContain('AI 해석:');
    expect(text).not.toContain('요약 (AI 정리)');
  });
});

describe('작업 20 · 개인정보 열은 넣지 않는다 (SC-8) — 사용자가 "반영"을 고르지 않으면', () => {
  it('참여자 정보(이름·사번·부서·직급·직위·직책)와 뺀 열(문항 파일에 없는 열)의 값이 파일 어디에도 없다', async () => {
    const text = allText(await build(base));
    expect(base.removed.map((r) => r.reason)).toEqual(['not-in-questions']);
    const columns = [...survey.responses.participants.map((p) => p.answers), ...base.removed.map((r) => r.column.answers)];
    expect(columns).toHaveLength(7);
    for (const answers of columns) {
      const values = new Set(answers.filter((a): a is string => a !== null && a.trim().length >= 3));
      expect(answers.some((a) => a !== null)).toBe(true); // (직급처럼 두 글자 값은 응답 글과 겹칠 수 있어 세 글자 이상만 비교한다)
      for (const value of values) expect(text, `열의 값 "${value}"`).not.toContain(value);
    }
  });

  it('"문항으로 되돌린" 열만 문항으로 들어가고, 다시 빼면 다시 없어진다', async () => {
    const extra = base.restorable.find((r) => r.reason === 'not-in-questions')!;
    const answer = base.removed.find((r) => r.reason === 'not-in-questions')!.column.answers.find((a) => a !== null)!;
    const restored = analyzeSurvey(survey, {}, [extra.key]);
    expect(allText(await build(restored))).toContain(answer);
    expect(allText(await build(analyzeSurvey(survey, {}, [])))).not.toContain(answer);
  });
});

describe('작업 20 · 바뀐 유형이 파일에 반영된다 (PRD Must 4)', () => {
  it('객관식을 주관식·서술형으로 바꾸면 3번 시트로 옮겨 가고 2번 시트에서는 빠진다', async () => {
    const choiceItem = base.questions.find((q) => q.outcome.type === 'choice')!;
    const no = choiceItem.question.no;
    const heading = `Q${no}. ${choiceItem.question.title}`;
    const changed = await build(analyzeSurvey(survey, { [no]: 'text' }));
    expect(findRow(changed.getWorksheet(SHEET_CHOICE)!, heading)).toBe(-1);
    expect(findRow(changed.getWorksheet(SHEET_TEXT)!, heading)).toBeGreaterThan(0);
    const summary = changed.getWorksheet(SHEET_SUMMARY)!;
    const row = base.questions.findIndex((q) => q.question.no === no) + 2;
    expect(val(summary, row, 3)).toBe('주관식·서술형');
    expect(val(summary, row, 6)).toBeNull();
  });
});

describe('작업 20 · 차트는 그림(PNG)으로 넣는다', () => {
  const choiceWithAnswers = base.questions.filter((q) => q.outcome.type === 'choice' && q.outcome.result.totalSelections > 0);

  it('그림 만들기를 주지 않으면 그림 없이 만든다', async () => {
    const ws = (await build(base)).getWorksheet(SHEET_CHOICE)!;
    expect(ws.getImages()).toHaveLength(0);
  });

  it('응답이 있는 객관식 문항마다 그림이 하나씩, 표 오른쪽(E열)·문항 제목 줄에 놓인다', async () => {
    const renderChart = vi.fn(async () => FAKE_PNG);
    const wb = await build(base, { renderChart });
    const ws = wb.getWorksheet(SHEET_CHOICE)!;
    expect(renderChart).toHaveBeenCalledTimes(choiceWithAnswers.length);
    const images = ws.getImages();
    expect(images).toHaveLength(choiceWithAnswers.length);
    choiceWithAnswers.forEach((item, i) => {
      const top = findRow(ws, `Q${item.question.no}. ${item.question.title}`);
      const tl = images[i].range.tl as unknown as { nativeCol: number; nativeRow: number };
      expect(tl.nativeCol).toBe(4); // E열 (0부터 센 4)
      expect(tl.nativeRow).toBe(top - 1); // 문항 제목 줄 (0부터 센 줄)
    });
    expect(wb.model.media).toHaveLength(choiceWithAnswers.length);
  });

  it('그림끼리, 그림과 다음 문항이 겹치지 않는다 (그림이 덮는 줄만큼 다음 문항이 아래에서 시작)', async () => {
    const wb = await build(base, { renderChart: async () => FAKE_PNG });
    const ws = wb.getWorksheet(SHEET_CHOICE)!;
    const tops = choiceWithAnswers.map((item) => findRow(ws, `Q${item.question.no}. ${item.question.title}`));
    choiceWithAnswers.forEach((item, i) => {
      if (i === 0) return;
      const need = Math.ceil(chartHeight((choiceWithAnswers[i - 1].outcome as { result: { rows: unknown[] } }).result.rows.length) / 20);
      expect(tops[i] - tops[i - 1], `Q${item.question.no} 앞 문항과의 간격`).toBeGreaterThanOrEqual(need);
    });
    expect(CHART_IMAGE_WIDTH).toBe(640);
  });

  it('응답이 없는 객관식은 그림을 만들지 않고, 그림 만들기가 null을 주면 그 문항은 그림 없이 만든다', async () => {
    const first = choiceWithAnswers[0];
    if (first.outcome.type !== 'choice') throw new Error();
    const empty: Analysis = {
      ...base,
      questions: [{ ...first, outcome: { type: 'choice', result: { ...first.outcome.result, totalSelections: 0, rows: first.outcome.result.rows.map((r) => ({ ...r, count: 0, percent: 0 })), noAnswer: first.outcome.result.respondents } } }],
    };
    const renderChart = vi.fn(async () => FAKE_PNG);
    const ws = (await build(empty, { renderChart })).getWorksheet(SHEET_CHOICE)!;
    expect(renderChart).not.toHaveBeenCalled();
    expect(ws.getImages()).toHaveLength(0);
    expect(allText(await build(empty))).toContain('응답한 사람이 없어서 보여 줄 결과가 없어요.');
    const wsNull = (await build(base, { renderChart: async () => null })).getWorksheet(SHEET_CHOICE)!;
    expect(wsNull.getImages()).toHaveLength(0);
  });
});
