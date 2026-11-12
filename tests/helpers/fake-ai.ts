// 시험용 가짜 AI (작업 16·22). 실제 AI를 부르지 않는다.

import { labelText } from '../../src/lib/ai/prompt';
import type { AiClient } from '../../src/lib/ai/types';

export type Mode = 'good' | 'invent-number' | 'invent-number-once';

/** 가짜 AI: 질문 글을 읽고 규칙에 맞는 답(good)을 하거나, 데이터에 없는 숫자를 섞은 답을 한다. 받은 글은 모두 기록한다 */
export function makeFakeAi(mode: Mode) {
  const seen: { system: string; prompt: string }[] = [];
  const callsByQuestion = new Map<number, number>();

  const ai: AiClient = {
    async complete({ system, prompt }) {
      seen.push({ system, prompt });
      const no = Number(/^문항 (\d+):/.exec(prompt)?.[1]);
      const call = (callsByQuestion.get(no) ?? 0) + 1;
      callsByQuestion.set(no, call);
      const bad = mode === 'invent-number' || (mode === 'invent-number-once' && call === 1);

      if (prompt.includes('출력 형식: {"text":')) {
        const rows = (prompt.split('<데이터>\n')[1].split('\n</데이터>')[0].split('\n')).map((line) => {
          const m = /^(.*): (\d+)건, ([\d.]+)%$/.exec(line) as RegExpExecArray;
          return { label: m[1], count: Number(m[2]), percent: m[3] };
        });
        const top = rows.reduce((a, b) => (b.count > a.count ? b : a));
        const text = `가장 많이 고른 선택지는 ${labelText(top.label)}이고 ${top.percent}%예요. 나머지 선택지는 그보다 적어요.${bad ? ' 전체 응답자는 999명이에요.' : ''}`;
        return JSON.stringify({ text });
      }
      const views = (prompt.split('<데이터> (한 줄에 관점 하나)\n')[1].split('\n</데이터>')[0].split('\n')).map((l) => JSON.parse(l) as { id: number });
      const groups = views.length >= 3 ? 3 : 1;
      const names = ['가', '나', '다'];
      const opinions = Array.from({ length: groups }, (_, g) => ({
        summary: `${names[g]} 의견${bad ? ' 999건' : ''}`,
        viewIds: views.filter((_v, i) => Math.floor((i * groups) / views.length) === g).map((v) => v.id),
      }));
      return JSON.stringify({ opinions });
    },
  };
  return { ai, seen, callsByQuestion };
}
