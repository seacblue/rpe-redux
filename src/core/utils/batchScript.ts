/**
 * The small compiled-expression and batch-script vocabulary.
 *
 * Trajectory formulas and extension expression parameters share these compiled
 * expressions; evaluation rejects unknown names and non-finite results, and batch
 * scripts compile into statements over named chart fields.
 */
import { t } from "../../i18n/index.ts";
import { easing } from "./easing.ts";
import { clamp } from "./numbers.ts";

/** A variable scope for a compiled expression: every name must resolve to a number. */
export type ExpressionScope = Record<string, number>;

/** A compiled expression. Throws on unknown variables and non-finite results. */
export type CompiledExpression = (scope: ExpressionScope) => number;

const functions = new Map<string, (...values: number[]) => number>([
  ["abs", Math.abs],
  ["min", Math.min],
  ["max", Math.max],
  ["floor", Math.floor],
  ["ceil", Math.ceil],
  ["round", Math.round],
  ["trunc", Math.trunc],
  ["sign", Math.sign],
  ["sgn", Math.sign],
  ["sin", Math.sin],
  ["cos", Math.cos],
  ["tan", Math.tan],
  ["asin", Math.asin],
  ["acos", Math.acos],
  ["atan", Math.atan],
  ["atan2", Math.atan2],
  ["arcsin", Math.asin],
  ["arccos", Math.acos],
  ["arctan", Math.atan],
  ["sinh", Math.sinh],
  ["cosh", Math.cosh],
  ["tanh", Math.tanh],
  ["sqrt", Math.sqrt],
  ["cbrt", Math.cbrt],
  ["pow", Math.pow],
  ["hypot", Math.hypot],
  ["exp", Math.exp],
  ["ln", Math.log],
  ["log10", Math.log10],
  ["log", (value, base = 10) => Math.log(value) / Math.log(base)],
  ["mod", (left, right) => left % right],
  ["clamp", clamp],
  ["lerp", (lower: number, upper: number, progress: number) => lower + (upper - lower) * progress],
  ["ease", (progress: number, type = 1) => easing(progress, type)],
]);

/** Names exposed by the expression compiler for editor legends. */
export const BATCH_EXPRESSION_FUNCTION_NAMES = Object.freeze([...functions.keys()]);

/** Constants the expression compiler resolves without a scope entry. */
export const BATCH_EXPRESSION_CONSTANT_NAMES = Object.freeze([
  "pi",
  "e",
  "tau",
  "true",
  "false",
] as const);

/** Whether a token can begin an atom and therefore participate in implicit multiplication. */
function startsAtom(token: string | undefined): boolean {
  return Boolean(token && (token === "(" || /^[A-Za-z_]/.test(token) || /^(\d|\.)/.test(token)));
}

const precedence: Record<string, number> = {
  "||": 1,
  "&&": 2,
  "==": 3,
  "!=": 3,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "+": 5,
  "-": 5,
  "*": 6,
  "/": 6,
  "%": 6,
  "^": 7,
  "**": 7,
};

/**
 * Compile a single expression over named numeric variables.
 *
 * The returned function throws when the source names an unknown variable, when a
 * division or power produces a non-finite result, or when the input exceeds the
 * length and token limits.
 */
export function compileExpression(source: string): CompiledExpression {
  if (source.length > 4096) {
    throw new Error(t("model.batch.expressionTooLong"));
  }
  const tokens: string[] = [];
  let offset = 0;
  while (offset < source.length) {
    const match =
      /^(\s+|(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*(?:\.[A-Za-z_][A-Za-z_0-9]*)?|\*\*|&&|\|\||==|!=|<=|>=|[+\-*/%^<>()!,?:])/i.exec(
        source.slice(offset),
      );
    if (!match) {
      throw new Error(
        t("model.batch.unsupportedCharacter", { text: source.slice(offset, offset + 12) }),
      );
    }
    offset += match[0].length;
    if (match[0].trim()) {
      tokens.push(match[0]);
    }
  }
  if (tokens.length > 512) {
    throw new Error(t("model.batch.expressionTooComplex"));
  }
  let cursor = 0;
  /** Consume the next token, failing when it is not the expected one. */
  const requireToken = (token: string): void => {
    if (tokens[cursor++] !== token) {
      throw new Error(t("model.batch.missingToken", { token }));
    }
  };
  /** Parse a prefix atom: literal, variable, function call, or parenthesized expression. */
  const atom = (): CompiledExpression => {
    const token = tokens[cursor++];
    if (!token) {
      throw new Error(t("model.batch.incompleteExpression"));
    }
    if (["+", "-", "!"].includes(token)) {
      const value = atom();
      return (scope) =>
        token === "-" ? -value(scope) : token === "!" ? Number(!value(scope)) : value(scope);
    }
    if (token === "(") {
      const value = expression();
      requireToken(")");
      return value;
    }
    if (/^(\d|\.)/.test(token)) {
      return () => Number(token);
    }
    if (!/^[A-Za-z_]/.test(token)) {
      throw new Error(t("model.batch.unparsableToken", { token }));
    }
    const name = token;
    const keyword = name.toLowerCase();
    const callable = functions.get(keyword);
    if (tokens[cursor] === "(" && callable) {
      cursor++;
      const args: CompiledExpression[] = [];
      if (tokens[cursor] !== ")") {
        do {
          args.push(expression());
          if (tokens[cursor] !== ",") {
            break;
          }
          cursor++;
        } while (true);
      }
      requireToken(")");
      return (scope) => callable(...args.map((arg) => arg(scope)));
    }
    return (scope) => {
      if (keyword === "pi") {
        return Math.PI;
      }
      if (keyword === "e") {
        return Math.E;
      }
      if (keyword === "tau") {
        return Math.PI * 2;
      }
      if (keyword === "true") {
        return 1;
      }
      if (keyword === "false") {
        return 0;
      }
      if (!Object.hasOwn(scope, name)) {
        throw new Error(t("model.batch.unknownVariable", { name }));
      }
      return scope[name];
    };
  };
  /** Parse a binary expression honoring precedence, then an optional ternary tail. */
  const expression = (minimum = 0): CompiledExpression => {
    let left = atom();
    while (true) {
      const next = tokens[cursor];
      const implicit = !Object.hasOwn(precedence, next) && startsAtom(next);
      const operator = implicit ? "*" : next;
      if (!Object.hasOwn(precedence, operator) || precedence[operator] < minimum) {
        break;
      }
      if (!implicit) {
        cursor++;
      }
      const before = left;
      const right = expression(precedence[operator] + (["^", "**"].includes(operator) ? 0 : 1));
      left = (scope) => {
        const first = before(scope);
        if (operator === "&&") {
          return Number(Boolean(first) && Boolean(right(scope)));
        }
        if (operator === "||") {
          return Number(Boolean(first) || Boolean(right(scope)));
        }
        const second = right(scope);
        switch (operator) {
          case "+":
            return first + second;
          case "-":
            return first - second;
          case "*":
            return first * second;
          case "/":
            return first / second;
          case "%":
            return first % second;
          case "^":
          case "**":
            return first ** second;
          case "==":
            return Number(first === second);
          case "!=":
            return Number(first !== second);
          case "<":
            return Number(first < second);
          case ">":
            return Number(first > second);
          case "<=":
            return Number(first <= second);
          case ">=":
            return Number(first >= second);
        }
        return first;
      };
    }
    if (minimum === 0 && tokens[cursor] === "?") {
      cursor++;
      const condition = left;
      const yes = expression();
      requireToken(":");
      const no = expression();
      left = (scope) => (condition(scope) ? yes(scope) : no(scope));
    }
    return left;
  };
  const result = expression();
  if (cursor !== tokens.length) {
    throw new Error(t("model.batch.trailingExpression", { token: tokens[cursor] }));
  }
  return (scope) => {
    const value = result(scope);
    if (!Number.isFinite(value)) {
      throw new Error(t("model.batch.nonFiniteResult"));
    }
    return value;
  };
}

/** One compiled assignment: `field operator expression`. */
export interface BatchStatement {
  field: string;
  operator: string;
  evaluate: CompiledExpression;
}

/**
 * Compile a semicolon- or newline-separated batch script into assignments over
 * the supplied field names. Comments start with `#`.
 */
export function compileBatchScript(source: string, fields: readonly string[]): BatchStatement[] {
  if (source.length > 16384) {
    throw new Error(t("model.batch.scriptTooLong"));
  }
  const statements = source
    .replace(/#[^\n]*/g, "")
    .split(/[;\n]/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (statements.length > 64) {
    throw new Error(t("model.batch.tooManyAssignments"));
  }
  return statements.map((statement) => {
    const match = /^([A-Za-z_][A-Za-z_0-9.]*)\s*(\+=|-=|\*=|\/=|=)\s*(.+)$/.exec(statement);
    if (!match || !fields.includes(match[1])) {
      throw new Error(t("model.batch.unsupportedAssignment", { statement }));
    }
    return { field: match[1], operator: match[2], evaluate: compileExpression(match[3]) };
  });
}
