import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Buffer } from "node:buffer";
import ts from "typescript";

const sourceUrl = new URL("../lib/parseNumber.ts", import.meta.url);
const source = await readFile(sourceUrl, "utf8");
const transpiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2022,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: "parseNumber.ts",
});
const moduleUrl = `data:text/javascript;base64,${Buffer.from(transpiled.outputText).toString("base64")}`;
const { parseOptionNumber } = await import(moduleUrl);

const cases = [
  ["1번", 1],
  ["삼번으로 가자", 3],
  ["두번째", 2],
  ["그냥 5번", 5],
  ["음 잘 모르겠어", null],
  ["다섯", 5],
];

for (const [input, expected] of cases) {
  assert.equal(parseOptionNumber(input), expected, `${input} → ${expected}`);
}

console.log(`parseNumber: ${cases.length} assertions passed`);
