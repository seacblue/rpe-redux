/** Tokenizes GLSL for the asset-library source preview without changing source text. */

export type ShaderTokenKind =
  "plain" | "comment" | "preprocessor" | "string" | "keyword" | "type" | "function" | "number";

export interface ShaderToken {
  text: string;
  kind: ShaderTokenKind;
}

const KEYWORDS = new Set([
  "attribute",
  "break",
  "case",
  "const",
  "continue",
  "default",
  "do",
  "else",
  "for",
  "if",
  "in",
  "inout",
  "layout",
  "out",
  "return",
  "struct",
  "switch",
  "uniform",
  "varying",
  "while",
]);

const TYPES = new Set([
  "bool",
  "float",
  "double",
  "int",
  "uint",
  "void",
  "vec2",
  "vec3",
  "vec4",
  "ivec2",
  "ivec3",
  "ivec4",
  "mat2",
  "mat3",
  "mat4",
  "sampler2D",
  "samplerCube",
]);

const FUNCTIONS = new Set([
  "abs",
  "clamp",
  "cos",
  "dot",
  "floor",
  "fract",
  "length",
  "mix",
  "normalize",
  "pow",
  "sin",
  "smoothstep",
  "step",
  "texture",
  "tan",
]);

const TOKEN_PATTERN =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?\b|\b[A-Za-z_][A-Za-z_0-9]*\b/g;

function kindFor(text: string): ShaderTokenKind {
  if (text.startsWith("//") || text.startsWith("/*")) {
    return "comment";
  }
  if (text.startsWith("#")) {
    return "preprocessor";
  }
  if (text.startsWith('"') || text.startsWith("'")) {
    return "string";
  }
  if (/^(?:\d|\.)/.test(text)) {
    return "number";
  }
  if (KEYWORDS.has(text)) {
    return "keyword";
  }
  if (TYPES.has(text)) {
    return "type";
  }
  if (FUNCTIONS.has(text)) {
    return "function";
  }
  return "plain";
}

/** Splits GLSL into display tokens while keeping comments, spacing, and punctuation intact. */
export function tokenizeShader(source: string): ShaderToken[] {
  const tokens: ShaderToken[] = [];
  let offset = 0;
  for (const match of source.matchAll(TOKEN_PATTERN)) {
    const start = match.index ?? offset;
    if (start > offset) {
      tokens.push({ text: source.slice(offset, start), kind: "plain" });
    }
    const text = match[0];
    tokens.push({ text, kind: kindFor(text) });
    offset = start + text.length;
  }
  if (offset < source.length) {
    tokens.push({ text: source.slice(offset), kind: "plain" });
  }
  return tokens;
}
