// Design Ref: §5 오류 — 요청 모양이 틀리면 400, 문항·보기·관점이 너무 많으면 413.
// 알려진 항목만 새로 만들어서 돌려준다. 요청에 딸려 온 다른 값(응답자 번호 등)은 AI에 넘어가지 않는다.

import { MAX_LABEL_LENGTH, MAX_QUESTIONS, MAX_ROWS, MAX_TITLE_LENGTH, MAX_VIEWS, MAX_VIEW_LENGTH } from './limits';
import type { InterpretRequest, QuestionInput } from './types';

export type RequestCheck = { ok: true; value: InterpretRequest } | { ok: false; status: 400 | 413; message: string };

const bad = (message: string): RequestCheck => ({ ok: false, status: 400, message });
const tooLarge = (message: string): RequestCheck => ({ ok: false, status: 413, message });

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);
const isText = (v: unknown, max: number): v is string => typeof v === 'string' && v.trim() !== '' && v.length <= max;

/** 요청 본문(JSON을 읽은 값)을 확인하고, 알려진 항목만 담은 요청으로 돌려준다 */
export function parseInterpretRequest(body: unknown): RequestCheck {
  if (!isRecord(body) || !Array.isArray(body.questions)) return bad('요청에 문항 목록(questions)이 없어요.');
  const list: unknown[] = body.questions;
  if (list.length === 0) return bad('해석할 문항이 없어요.');
  if (list.length > MAX_QUESTIONS) return tooLarge(`한 번에 ${MAX_QUESTIONS}개 문항까지만 해석할 수 있어요.`);

  const seen = new Set<number>();
  const questions: QuestionInput[] = [];

  for (const [index, raw] of list.entries()) {
    const place = `${index + 1}번째 문항`;
    if (!isRecord(raw)) return bad(`${place}의 모양이 틀려요.`);
    if (!isInt(raw.no) || raw.no < 1) return bad(`${place}의 번호(no)가 올바르지 않아요.`);
    if (seen.has(raw.no)) return bad(`문항 번호 ${raw.no}이(가) 겹쳐요.`);
    seen.add(raw.no);
    if (!isText(raw.title, MAX_TITLE_LENGTH)) return bad(`${place}의 질문(title)이 비어 있거나 너무 길어요.`);

    if (raw.type === 'choice') {
      if (!Array.isArray(raw.rows) || raw.rows.length === 0) return bad(`${place}의 보기 집계(rows)가 없어요.`);
      if (raw.rows.length > MAX_ROWS) return tooLarge(`${place}의 보기가 ${MAX_ROWS}개를 넘어요.`);
      const rows: { label: string; count: number; percent: number }[] = [];
      for (const row of raw.rows as unknown[]) {
        if (!isRecord(row) || !isText(row.label, MAX_LABEL_LENGTH)) return bad(`${place}의 보기 이름(label)이 올바르지 않아요.`);
        if (!isInt(row.count) || row.count < 0) return bad(`${place}의 응답 수(count)가 올바르지 않아요.`);
        if (typeof row.percent !== 'number' || !Number.isFinite(row.percent) || row.percent < 0 || row.percent > 100) {
          return bad(`${place}의 비율(percent)이 올바르지 않아요.`);
        }
        rows.push({ label: row.label, count: row.count, percent: row.percent });
      }
      questions.push({ no: raw.no, type: 'choice', title: raw.title, rows });
    } else if (raw.type === 'text') {
      if (!Array.isArray(raw.views)) return bad(`${place}의 관점 목록(views)이 없어요.`);
      if (raw.views.length > MAX_VIEWS) return tooLarge(`${place}의 관점이 ${MAX_VIEWS}개를 넘어요.`);
      const ids = new Set<number>();
      const views: { id: number; text: string }[] = [];
      for (const view of raw.views as unknown[]) {
        if (!isRecord(view) || !isInt(view.id) || view.id < 1) return bad(`${place}의 관점 번호(id)가 올바르지 않아요.`);
        if (!isText(view.text, MAX_VIEW_LENGTH)) return bad(`${place}의 관점 글(text)이 비어 있거나 너무 길어요.`);
        if (ids.has(view.id)) return bad(`${place}의 관점 번호 ${view.id}이(가) 겹쳐요.`);
        ids.add(view.id);
        views.push({ id: view.id, text: view.text });
      }
      questions.push({ no: raw.no, type: 'text', title: raw.title, views });
    } else {
      return bad(`${place}의 유형(type)은 choice 또는 text여야 해요.`);
    }
  }
  return { ok: true, value: { questions } };
}
