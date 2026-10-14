// P0-18: which script line is being said? (js/captions/matcher.js)
import { describe, expect, it } from "vitest";
import { createMatcher } from "../../public/js/captions/matcher.js";

const line = (ko: string) => ({ ko, en: `EN: ${ko}` });
const slides = [
  {
    lines: [
      line("안녕하세요 여러분 오늘 발표를 시작하겠습니다"),
      line("저는 카카오뱅크에서 백엔드 개발자로 일하고 있습니다"),
    ],
  },
  {
    lines: [
      line("핸드폰 잠깐만 보려고 했는데 정신 차려 보면 삼십 분이 지나 있는 경험"),
      line("요즘은 긴 콘텐츠보다 짧은 콘텐츠가 훨씬 쉽게 소비되잖아요"),
      line("저희는 이 습관을 조금 다르게 활용해 보고 싶었습니다"),
    ],
  },
  {
    lines: [
      line("전체 파이프라인을 여덟 개의 노드로 나누고 각 노드가 하나의 역할만 하도록 설계했습니다"),
    ],
  },
];

describe("matcher", () => {
  it("finds a line from a space-less, partial phrase", () => {
    const m = createMatcher(slides);
    const r = m.match("요즘은긴콘텐츠보다짧은콘텐츠가", 1);
    expect(r).toMatchObject({ slide: 1, line: 1 });
    expect(r.score).toBeGreaterThan(0.5);
  });

  it("tolerates wrong and missing characters", () => {
    const m = createMatcher(slides);
    // 3 of ~30 characters are wrong or dropped
    const r = m.match("저희는 이 슴관을 조금 다르게 활용해 보고 싶었습니", 1);
    expect(r).toMatchObject({ slide: 1, line: 2 });
  });

  it("gives unrelated speech a score below the 0.4 acceptance threshold", () => {
    const m = createMatcher(slides);
    for (const text of [
      "잠깐 물 좀 마시고 하겠습니다",
      "질문 있으신 분 계신가요 손 들어 주세요",
      "날씨가 많이 추워졌네요",
    ]) {
      const r = m.match(text, 1);
      expect(r?.score ?? 0).toBeLessThan(0.4);
    }
  });

  it("ignores phrases that are too short to place", () => {
    expect(createMatcher(slides).match("네", 1)).toBeNull();
  });

  it("looks at the neighbouring slides too, with a penalty", () => {
    const m = createMatcher(slides);
    // said while the presenter is still on slide 1, but belongs to slide 2
    const r = m.match("전체파이프라인을여덟개의노드로나누고", 1);
    expect(r).toMatchObject({ slide: 2, line: 0 });
    const same = m.match("전체파이프라인을여덟개의노드로나누고", 2);
    expect(same.score).toBeGreaterThan(r.score);
  });

  it("favours the line after the last accepted one when two lines are alike", () => {
    const twins = [
      {
        lines: [
          line("이 부분은 정말 중요한 내용입니다 잘 들어 주세요"),
          line("이 부분은 정말 중요한 내용입니다 꼭 기억해 주세요"),
        ],
      },
    ];
    const m = createMatcher(twins);
    const first = m.match("이 부분은 정말 중요한 내용입니다", 0);
    m.accept({ slide: 0, line: 0 });
    const second = m.match("이 부분은 정말 중요한 내용입니다", 0);
    expect(first).not.toBeNull();
    expect(second).toMatchObject({ slide: 0, line: 1 }); // moves on to the next line
    m.reset();
  });

  it("returns the reviewed English with the match", () => {
    const r = createMatcher(slides).match("안녕하세요여러분오늘발표를시작하겠습니다", 0);
    expect(r).toMatchObject({
      slide: 0,
      line: 0,
      en: "EN: 안녕하세요 여러분 오늘 발표를 시작하겠습니다",
    });
  });
});
