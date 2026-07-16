const explicitNumberWords: ReadonlyArray<readonly [RegExp, number]> = [
  [/(?:첫|하나|한)\s*번(?:째)?/, 1],
  [/(?:두|둘)\s*번(?:째)?/, 2],
  [/(?:세|셋)\s*번(?:째)?/, 3],
  [/(?:네|넷)\s*번(?:째)?/, 4],
  [/(?:다섯)\s*번(?:째)?/, 5],
  [/(?:여섯)\s*번(?:째)?/, 6],
  [/(?:일곱)\s*번(?:째)?/, 7],
  [/(?:여덟)\s*번(?:째)?/, 8],
  [/(?:아홉)\s*번(?:째)?/, 9],
  [/일\s*번(?:째)?/, 1],
  [/이\s*번(?:째)?/, 2],
  [/삼\s*번(?:째)?/, 3],
  [/사\s*번(?:째)?/, 4],
  [/오\s*번(?:째)?/, 5],
  [/육\s*번(?:째)?/, 6],
  [/칠\s*번(?:째)?/, 7],
  [/팔\s*번(?:째)?/, 8],
  [/구\s*번(?:째)?/, 9],
];

const standaloneNumberWords: ReadonlyArray<readonly [string, number]> = [
  ["하나", 1],
  ["둘", 2],
  ["셋", 3],
  ["넷", 4],
  ["다섯", 5],
  ["여섯", 6],
  ["일곱", 7],
  ["여덟", 8],
  ["아홉", 9],
  ["일", 1],
  ["이", 2],
  ["삼", 3],
  ["사", 4],
  ["오", 5],
  ["육", 6],
  ["칠", 7],
  ["팔", 8],
  ["구", 9],
];

function clampOption(value: number, maxOptions?: number): number | null {
  if (!Number.isFinite(value)) return null;
  const integer = Math.trunc(value);
  if (maxOptions === undefined) return integer >= 1 ? integer : null;
  if (!Number.isInteger(maxOptions) || maxOptions < 1) return null;
  return Math.min(maxOptions, Math.max(1, integer));
}

export function parseOptionNumber(
  input: string | null | undefined,
  maxOptions?: number,
): number | null {
  const text = input?.trim();
  if (!text) return null;

  const markedDigit = /(?:^|[^0-9])(\d{1,3})\s*(?:번|번째)/.exec(text);
  if (markedDigit) return clampOption(Number(markedDigit[1]), maxOptions);

  for (const [pattern, value] of explicitNumberWords) {
    if (pattern.test(text)) return clampOption(value, maxOptions);
  }

  const directionalDigit = new RegExp(
    "(?:^|[^\\p{L}\\p{N}])(\\d{1,3})\\s*(?:으로|로)(?:\\s|$)",
    "u",
  ).exec(text);
  if (directionalDigit) {
    return clampOption(Number(directionalDigit[1]), maxOptions);
  }

  const standaloneDigit = /^\s*(\d{1,3})\s*$/.exec(text);
  if (standaloneDigit) {
    return clampOption(Number(standaloneDigit[1]), maxOptions);
  }

  for (const [word, value] of standaloneNumberWords) {
    const directionalPattern = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${word}\\s*(?:으로|로)(?:\\s|$)`,
      "u",
    );
    if (directionalPattern.test(text)) return clampOption(value, maxOptions);

    const pattern = new RegExp(
      `(?:^|[^\\p{L}\\p{N}])${word}(?:$|[^\\p{L}\\p{N}])`,
      "u",
    );
    if (pattern.test(text)) return clampOption(value, maxOptions);
  }

  return null;
}

export const parseNumber = parseOptionNumber;
