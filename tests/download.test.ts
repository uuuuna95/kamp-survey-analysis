// Design Ref: §2 ② — 작업 21: 내려받는 파일 이름, 엑셀에 넣을 AI 해석 고르기. 실행: npm test
// (파일을 실제로 내려받는 부분은 브라우저에서만 되어서 화면에서 확인한다)

import { describe, expect, it } from 'vitest';
import { doneInterpretations } from '../src/lib/ai/client';
import type { CardAiState } from '../src/lib/ai/client';
import { XLSX_MIME, resultFileName } from '../src/lib/excel/download';

describe('작업 21 · 파일 이름', () => {
  it('"설문결과_연-월-일.xlsx" 모양이고, 월·일은 두 자리로 맞춘다', () => {
    expect(resultFileName(new Date(2026, 10, 12))).toBe('설문결과_2026-11-12.xlsx');
    expect(resultFileName(new Date(2026, 0, 5))).toBe('설문결과_2026-01-05.xlsx');
    expect(resultFileName(new Date(2027, 11, 31, 23, 59))).toBe('설문결과_2027-12-31.xlsx');
  });

  it('엑셀(.xlsx) 형식으로 내려받는다', () => {
    expect(XLSX_MIME).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(resultFileName(new Date())).toMatch(/^설문결과_\d{4}-\d{2}-\d{2}\.xlsx$/);
  });
});

describe('작업 21 · 엑셀에 넣을 AI 해석 (doneInterpretations)', () => {
  const items: Record<number, CardAiState> = {
    1: { status: 'done', interpretation: { text: '해석 1' } },
    2: { status: 'loading' },
    3: { status: 'failed' },
    4: { status: 'done', interpretation: { opinions: [{ summary: '의견', viewIds: [1], count: 2 }] } },
    5: { status: 'done', interpretation: {} },
  };

  it('완료된 문항의 해석만 담고, 불러오는 중·실패한 문항은 뺀다', () => {
    expect(Object.keys(doneInterpretations(items)).map(Number)).toEqual([1, 4, 5]);
    expect(doneInterpretations(items)[1]).toEqual({ text: '해석 1' });
    expect(doneInterpretations(items)[4].opinions?.[0].count).toBe(2);
  });

  it('해석이 하나도 없으면 빈 객체', () => {
    expect(doneInterpretations({})).toEqual({});
    expect(doneInterpretations({ 1: { status: 'failed' } })).toEqual({});
  });
});
